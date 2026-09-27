import { createHash } from "node:crypto";
import { LedgerError, rethrowDatabaseError } from "./errors";
import type { SqlExecutor, SqlRow } from "./sql";

/**
 * The idempotency middleware behind the SRS safety requirement that a repeat
 * key returns the original result without re-executing the operation.
 *
 * The claim is taken inside the same transaction as the work it guards, which
 * is what makes the guarantee hold rather than merely usually hold. A second
 * request arriving while the first is still open blocks on the key's row
 * instead of racing it, and is then served the stored response once the first
 * commits. If the first rolls back, the key vanishes with it and the second
 * request proceeds as the original. No cleanup job, no window.
 */

export interface IdempotencyRequest {
  readonly idempotencyKey: string;
  /** Which operation the key belongs to, such as `"UC2-04:commit"`. */
  readonly scope: string;
  /** Digest of the request, so a reused key with a different body is caught. */
  readonly fingerprint: string;
}

export type IdempotencyClaim =
  | { readonly status: "CLAIMED" }
  | { readonly status: "REPLAY"; readonly value: unknown };

const MAX_CLAIM_ATTEMPTS = 3;

interface ExistingKeyRow extends SqlRow {
  readonly status: unknown;
  readonly request_fingerprint: unknown;
  readonly response: unknown;
}

export class PostgresIdempotencyStore {
  readonly #sql: SqlExecutor;

  constructor(sql: SqlExecutor) {
    this.#sql = sql;
  }

  /**
   * Claims the key for this transaction, or reports that the work has already
   * been done.
   *
   * @throws LedgerError `IDEMPOTENCY_CONFLICT` when the key was used for a
   * different request, and `IDEMPOTENCY_IN_FLIGHT` when an earlier attempt is
   * still running.
   */
  async claim(request: IdempotencyRequest): Promise<IdempotencyClaim> {
    requireText(request.idempotencyKey, "idempotencyKey");
    requireText(request.scope, "scope");
    requireText(request.fingerprint, "fingerprint");

    return this.#claim(request, 1);
  }

  async #claim(
    request: IdempotencyRequest,
    attempt: number,
  ): Promise<IdempotencyClaim> {
    const claimed = await this.#query<{ idempotency_key: unknown }>(
      `insert into idempotency_keys (idempotency_key, scope, request_fingerprint)
       values ($1, $2, $3)
       on conflict (idempotency_key) do nothing
       returning idempotency_key`,
      [request.idempotencyKey, request.scope, request.fingerprint],
    );

    if (claimed[0] !== undefined) return { status: "CLAIMED" };

    const rows = await this.#query<ExistingKeyRow>(
      `select status, request_fingerprint, response
         from idempotency_keys
        where idempotency_key = $1`,
      [request.idempotencyKey],
    );

    const existing = rows[0];
    if (existing === undefined) {
      // The holder rolled back between the insert and this read, so the key is
      // free again. Bounded, so a caller that keeps losing the race fails
      // loudly rather than spinning.
      if (attempt >= MAX_CLAIM_ATTEMPTS) {
        throw new LedgerError(
          "SERIALISATION_FAILURE",
          `Could not claim idempotency key ${request.idempotencyKey} after ${attempt} attempts`,
        );
      }
      return this.#claim(request, attempt + 1);
    }

    if (existing.request_fingerprint !== request.fingerprint) {
      throw new LedgerError(
        "IDEMPOTENCY_CONFLICT",
        `Idempotency key ${request.idempotencyKey} was already used for a different request`,
      );
    }

    switch (existing.status) {
      case "SUCCEEDED":
        return { status: "REPLAY", value: unwrap(existing.response) };

      case "FAILED": {
        // A failed attempt may be retried under the same key. Reclaiming it
        // conditionally means only one retry wins.
        const reclaimed = await this.#query<{ idempotency_key: unknown }>(
          `update idempotency_keys
              set status = 'IN_PROGRESS',
                  completed_at = null,
                  failure_reason = null
            where idempotency_key = $1
              and status = 'FAILED'
              and request_fingerprint = $2
          returning idempotency_key`,
          [request.idempotencyKey, request.fingerprint],
        );

        if (reclaimed[0] !== undefined) return { status: "CLAIMED" };

        throw new LedgerError(
          "IDEMPOTENCY_IN_FLIGHT",
          `Idempotency key ${request.idempotencyKey} was retried concurrently`,
        );
      }

      default:
        throw new LedgerError(
          "IDEMPOTENCY_IN_FLIGHT",
          `Idempotency key ${request.idempotencyKey} is still being processed`,
        );
    }
  }

  /** Records the result, in the same transaction as the work that produced it. */
  async succeed(idempotencyKey: string, value: unknown): Promise<void> {
    await this.#query(
      `update idempotency_keys
          set status = 'SUCCEEDED',
              response = $2::jsonb,
              completed_at = now()
        where idempotency_key = $1`,
      [idempotencyKey, JSON.stringify({ value: value ?? null })],
    );
  }

  /**
   * Marks a key as failed so it may be retried.
   *
   * Only useful when the failure is recorded in a transaction that commits. A
   * unit of work that rolls back removes the key entirely, which has the same
   * effect.
   */
  async fail(idempotencyKey: string, reason: string): Promise<void> {
    await this.#query(
      `update idempotency_keys
          set status = 'FAILED',
              failure_reason = $2,
              completed_at = now()
        where idempotency_key = $1`,
      [idempotencyKey, reason],
    );
  }

  async #query<TRow extends SqlRow = SqlRow>(
    text: string,
    values: readonly unknown[],
  ): Promise<readonly TRow[]> {
    try {
      return await this.#sql.query<TRow>(text, values);
    } catch (error) {
      rethrowDatabaseError(error);
    }
  }
}

/**
 * A digest of the request, for detecting a key reused with a different body.
 *
 * Object keys are sorted before hashing so that two structurally identical
 * requests agree whatever order their fields arrived in.
 */
export function fingerprintOf(request: unknown): string {
  return createHash("sha256").update(stableStringify(request)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(",")}}`;
}

function unwrap(response: unknown): unknown {
  const envelope = typeof response === "string" ? JSON.parse(response) : response;

  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("value" in envelope)
  ) {
    throw new LedgerError(
      "INVARIANT_VIOLATED",
      "A stored idempotency response is not a recognised envelope",
    );
  }

  return (envelope as { value: unknown }).value;
}

function requireText(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LedgerError("INVALID_INSTRUCTION", `${name} is required`);
  }
}
