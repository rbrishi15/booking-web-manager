import { copyDate, copyOptionalDate } from "../shared/date";
import { DomainError, requireDomain } from "../shared/errors";
import type {
  PayoutDestination,
  PayoutRequestedIntent,
  SettlementBatch,
} from "../shared/operations";
import type { PayoutStatus } from "../shared/statuses";
import type { UUID } from "../shared/types";
import { Money } from "./money";

export interface PayoutDetails {
  readonly payoutId: UUID;
  readonly sessionId: UUID;
  readonly payoutAccountId: UUID;
  readonly amount: Money;
  readonly status: PayoutStatus;
  readonly idempotencyKey: string;
  readonly requestedAt: Date;
  readonly completedAt?: Date;
  readonly failedAt?: Date;
  readonly failureReason?: string;
  readonly providerReference?: string;
  readonly destination: PayoutDestination;
  readonly lines: readonly SettlementBatch["lines"][number][];
}

/**
 * Aggregate root: Payout.
 * Owns one provider attempt's status and outcome, with fixed settlement lines,
 * amount, destination, and idempotency key. Completion and failure commands enter
 * through this root; terminal outcomes are retained and retries use a new root.
 * The referenced Session owns the participations and holds. An application
 * coordinator combines both roots' changes and the resulting ledger effects.
 * See docs/adr/0003-aggregate-roots-and-boundaries.md.
 */
export class Payout {
  readonly #payoutId: UUID;
  readonly #sessionId: UUID;
  readonly #payoutAccountId: UUID;
  readonly #amount: Money;
  #status: PayoutStatus;
  readonly #idempotencyKey: string;
  readonly #requestedAt: Date;
  #completedAt?: Date;
  #failedAt?: Date;
  #failureReason?: string;
  #providerReference?: string;
  readonly #destination: PayoutDestination;
  readonly #lines: readonly SettlementBatch["lines"][number][];

  constructor(details: PayoutDetails) {
    requireDomain(
      ["REQUESTED", "COMPLETED", "FAILED"].includes(details.status),
      "INVALID_INPUT",
      "Unknown payout status",
    );
    requireDomain(
      details.amount instanceof Money,
      "INVALID_INPUT",
      "Payout amount must be Money",
    );
    requireDomain(
      Array.isArray(details.lines),
      "INVALID_INPUT",
      "A payout needs settlement lines",
    );
    requireDomain(
      details.destination !== undefined && details.destination !== null,
      "INVALID_INPUT",
      "A payout needs a destination",
    );
    validateText(details.payoutId, "payoutId");
    validateText(details.sessionId, "sessionId");
    validateText(details.idempotencyKey, "idempotencyKey");
    validateBatch({
      payoutId: details.payoutId,
      sessionId: details.sessionId,
      idempotencyKey: details.idempotencyKey,
      requestedAt: details.requestedAt,
      destination: details.destination,
      lines: details.lines,
    });
    const amount = details.lines.reduce(
      (sum, line) => sum.add(line.amount),
      Money.fromCents(0),
    );
    requireDomain(
      details.amount.equals(amount),
      "INVALID_INPUT",
      "Payout amount must equal its settlement lines",
    );
    requireDomain(
      details.payoutAccountId === details.destination.payoutAccountId,
      "INVALID_INPUT",
      "Payout account must match its destination",
    );
    if (details.status === "COMPLETED") {
      validateText(details.providerReference, "providerReference");
      requireDomain(
        details.completedAt !== undefined &&
          details.failedAt === undefined &&
          details.failureReason === undefined,
        "INVALID_INPUT",
        "A completed payout needs only completedAt",
      );
    } else if (details.status === "FAILED") {
      validateText(details.failureReason, "failureReason");
      requireDomain(
        details.failedAt !== undefined &&
          details.completedAt === undefined &&
          details.providerReference === undefined,
        "INVALID_INPUT",
        "A failed payout needs failedAt and a reason",
      );
    } else {
      requireDomain(
        details.completedAt === undefined &&
          details.failedAt === undefined &&
          details.failureReason === undefined &&
          details.providerReference === undefined,
        "INVALID_INPUT",
        "A requested payout cannot contain an outcome",
      );
    }

    this.#payoutId = details.payoutId;
    this.#sessionId = details.sessionId;
    this.#payoutAccountId = details.payoutAccountId;
    this.#amount = details.amount;
    this.#status = details.status;
    this.#idempotencyKey = details.idempotencyKey;
    this.#requestedAt = copyDate(details.requestedAt, "requestedAt");
    this.#completedAt = copyOptionalDate(details.completedAt, "completedAt");
    this.#failedAt = copyOptionalDate(details.failedAt, "failedAt");
    this.#failureReason = details.failureReason;
    this.#providerReference = details.providerReference;
    this.#destination = { ...details.destination };
    this.#lines = details.lines.map((line) => ({ ...line }));
  }

  static create(batch: SettlementBatch): Payout {
    validateBatch(batch);
    const amount = batch.lines.reduce(
      (sum, line) => sum.add(line.amount),
      Money.fromCents(0),
    );
    return new Payout({
      payoutId: batch.payoutId,
      sessionId: batch.sessionId,
      payoutAccountId: batch.destination.payoutAccountId,
      amount,
      status: "REQUESTED",
      idempotencyKey: batch.idempotencyKey,
      requestedAt: batch.requestedAt,
      destination: { ...batch.destination },
      lines: [...batch.lines],
    });
  }

  complete(providerReference: string, at: Date): boolean {
    validateText(providerReference, "providerReference");
    const completedAt = copyDate(at, "completedAt");
    if (this.status === "COMPLETED") {
      if (this.providerReference === providerReference) return false;
      throw new DomainError(
        "PAYOUT_CONFLICT",
        "A payout already completed with another provider reference",
      );
    }
    if (this.status === "FAILED")
      throw new DomainError(
        "STALE_PAYOUT",
        "A failed payout cannot be completed",
      );
    this.#status = "COMPLETED";
    this.#completedAt = completedAt;
    this.#providerReference = providerReference;
    return true;
  }

  fail(reason: string, at: Date): boolean {
    validateText(reason, "failureReason");
    const failedAt = copyDate(at, "failedAt");
    if (this.status === "FAILED") {
      if (this.failureReason === reason) return false;
      throw new DomainError(
        "PAYOUT_CONFLICT",
        "A payout already failed with another reason",
      );
    }
    if (this.status === "COMPLETED")
      throw new DomainError("STALE_PAYOUT", "A completed payout cannot fail");
    this.#status = "FAILED";
    this.#failedAt = failedAt;
    this.#failureReason = reason;
    return true;
  }

  requestedIntent(): PayoutRequestedIntent {
    return Object.freeze({
      kind: "PAYOUT_REQUESTED",
      payoutId: this.payoutId,
      sessionId: this.sessionId,
      idempotencyKey: this.idempotencyKey,
      amount: this.amount,
      destination: Object.freeze({ ...this.destination }),
      requestedAt: this.requestedAt,
    });
  }

  get payoutId(): UUID {
    return this.#payoutId;
  }
  get sessionId(): UUID {
    return this.#sessionId;
  }
  get payoutAccountId(): UUID {
    return this.#payoutAccountId;
  }
  get amount(): Money {
    return this.#amount;
  }
  get status(): PayoutStatus {
    return this.#status;
  }
  get idempotencyKey(): string {
    return this.#idempotencyKey;
  }
  get requestedAt(): Date {
    return copyDate(this.#requestedAt, "requestedAt");
  }
  get completedAt(): Date | undefined {
    return copyOptionalDate(this.#completedAt, "completedAt");
  }
  get failedAt(): Date | undefined {
    return copyOptionalDate(this.#failedAt, "failedAt");
  }
  get failureReason(): string | undefined {
    return this.#failureReason;
  }
  get providerReference(): string | undefined {
    return this.#providerReference;
  }
  get destination(): PayoutDestination {
    return { ...this.#destination };
  }
  get lines(): readonly SettlementBatch["lines"][number][] {
    return this.#lines.map((line) => ({ ...line }));
  }
}

function validateBatch(batch: SettlementBatch): void {
  validateText(batch.payoutId, "payoutId");
  validateText(batch.sessionId, "sessionId");
  validateText(batch.idempotencyKey, "idempotencyKey");
  copyDate(batch.requestedAt, "requestedAt");
  requireDomain(
    batch.destination !== undefined && batch.destination !== null,
    "INVALID_INPUT",
    "A payout needs a destination",
  );
  validateText(batch.destination.payoutAccountId, "payoutAccountId");
  validateText(batch.destination.userId, "userId");
  validateText(
    batch.destination.providerAccountReference,
    "providerAccountReference",
  );
  validateText(batch.destination.bankAccountReference, "bankAccountReference");
  requireDomain(
    Array.isArray(batch.lines) && batch.lines.length > 0,
    "INVALID_INPUT",
    "A payout batch must contain at least one line",
  );
  const ids = new Set(batch.lines.map((line) => line.holdId));
  requireDomain(
    ids.size === batch.lines.length,
    "DUPLICATE_ID",
    "A payout batch cannot repeat a hold",
  );
  for (const line of batch.lines)
    requireDomain(
      typeof line.holdId === "string" &&
        line.holdId.trim() !== "" &&
        typeof line.participationId === "string" &&
        line.participationId.trim() !== "" &&
        typeof line.holdingAccountId === "string" &&
        line.holdingAccountId.trim() !== "" &&
        typeof line.walletId === "string" &&
        line.walletId.trim() !== "" &&
        line.amount instanceof Money &&
        line.amount.toCents() > 0,
      "INVALID_INPUT",
      "A payout line must be positive",
    );
  for (const line of batch.lines)
    requireDomain(
      line.kind === "RELEASE" || line.kind === "FORFEIT",
      "INVALID_INPUT",
      "Unknown payout line kind",
    );
}

function validateText(
  value: string | undefined,
  name: string,
): asserts value is string {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
