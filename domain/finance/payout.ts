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

export interface PayoutSnapshot {
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

/** Aggregate representing one immutable settlement batch and its provider attempt. */
export class Payout {
  #snapshot: PayoutSnapshot;

  private constructor(snapshot: PayoutSnapshot) {
    this.#snapshot = Object.freeze({
      ...snapshot,
      requestedAt: copyDate(snapshot.requestedAt, "requestedAt"),
      completedAt: copyOptionalDate(snapshot.completedAt, "completedAt"),
      failedAt: copyOptionalDate(snapshot.failedAt, "failedAt"),
      destination: Object.freeze({ ...snapshot.destination }),
      lines: Object.freeze(snapshot.lines.map((line) => ({ ...line }))),
    });
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

  static reconstitute(snapshot: PayoutSnapshot): Payout {
    requireDomain(
      ["REQUESTED", "COMPLETED", "FAILED"].includes(snapshot.status),
      "INVALID_INPUT",
      "Unknown payout status",
    );
    requireDomain(
      snapshot.amount instanceof Money,
      "INVALID_INPUT",
      "Payout amount must be Money",
    );
    requireDomain(
      Array.isArray(snapshot.lines),
      "INVALID_INPUT",
      "A payout needs settlement lines",
    );
    requireDomain(
      snapshot.destination !== undefined && snapshot.destination !== null,
      "INVALID_INPUT",
      "A payout needs a destination",
    );
    validateText(snapshot.payoutId, "payoutId");
    validateText(snapshot.sessionId, "sessionId");
    validateText(snapshot.idempotencyKey, "idempotencyKey");
    validateBatch({
      payoutId: snapshot.payoutId,
      sessionId: snapshot.sessionId,
      idempotencyKey: snapshot.idempotencyKey,
      requestedAt: snapshot.requestedAt,
      destination: snapshot.destination,
      lines: snapshot.lines,
    });
    const amount = snapshot.lines.reduce(
      (sum, line) => sum.add(line.amount),
      Money.fromCents(0),
    );
    requireDomain(
      snapshot.amount.equals(amount),
      "INVALID_INPUT",
      "Payout amount must equal its settlement lines",
    );
    requireDomain(
      snapshot.payoutAccountId === snapshot.destination.payoutAccountId,
      "INVALID_INPUT",
      "Payout account must match its destination",
    );
    if (snapshot.status === "COMPLETED") {
      validateText(snapshot.providerReference, "providerReference");
      requireDomain(
        snapshot.completedAt !== undefined &&
          snapshot.failedAt === undefined &&
          snapshot.failureReason === undefined,
        "INVALID_INPUT",
        "A completed payout needs only completedAt",
      );
    } else if (snapshot.status === "FAILED") {
      validateText(snapshot.failureReason, "failureReason");
      requireDomain(
        snapshot.failedAt !== undefined &&
          snapshot.completedAt === undefined &&
          snapshot.providerReference === undefined,
        "INVALID_INPUT",
        "A failed payout needs failedAt and a reason",
      );
    } else {
      requireDomain(
        snapshot.completedAt === undefined &&
          snapshot.failedAt === undefined &&
          snapshot.failureReason === undefined &&
          snapshot.providerReference === undefined,
        "INVALID_INPUT",
        "A requested payout cannot contain an outcome",
      );
    }
    return new Payout({ ...snapshot, amount });
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
    return this.replace({
      status: "COMPLETED",
      completedAt,
      providerReference,
    });
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
    return this.replace({
      status: "FAILED",
      failedAt,
      failureReason: reason,
    });
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

  snapshot(): PayoutSnapshot {
    return {
      ...this.#snapshot,
      requestedAt: this.requestedAt,
      completedAt: this.completedAt,
      failedAt: this.failedAt,
      destination: { ...this.destination },
      lines: this.lines.map((line) => ({ ...line })),
    };
  }

  get payoutId(): UUID {
    return this.#snapshot.payoutId;
  }
  get sessionId(): UUID {
    return this.#snapshot.sessionId;
  }
  get payoutAccountId(): UUID {
    return this.#snapshot.payoutAccountId;
  }
  get amount(): Money {
    return this.#snapshot.amount;
  }
  get status(): PayoutStatus {
    return this.#snapshot.status;
  }
  get idempotencyKey(): string {
    return this.#snapshot.idempotencyKey;
  }
  get requestedAt(): Date {
    return copyDate(this.#snapshot.requestedAt, "requestedAt");
  }
  get completedAt(): Date | undefined {
    return copyOptionalDate(this.#snapshot.completedAt, "completedAt");
  }
  get failedAt(): Date | undefined {
    return copyOptionalDate(this.#snapshot.failedAt, "failedAt");
  }
  get failureReason(): string | undefined {
    return this.#snapshot.failureReason;
  }
  get providerReference(): string | undefined {
    return this.#snapshot.providerReference;
  }
  get destination(): PayoutDestination {
    return { ...this.#snapshot.destination };
  }
  get lines(): readonly SettlementBatch["lines"][number][] {
    return this.#snapshot.lines.map((line) => ({ ...line }));
  }

  private replace(change: Partial<PayoutSnapshot>): boolean {
    const next = { ...this.snapshot(), ...change };
    if (next.status === "COMPLETED") {
      next.failedAt = undefined;
      next.failureReason = undefined;
    }
    if (next.status === "FAILED") {
      next.completedAt = undefined;
      next.providerReference = undefined;
    }
    this.#snapshot = Object.freeze({
      ...next,
      requestedAt: copyDate(next.requestedAt, "requestedAt"),
      completedAt: copyOptionalDate(next.completedAt, "completedAt"),
      failedAt: copyOptionalDate(next.failedAt, "failedAt"),
      destination: Object.freeze({ ...next.destination }),
      lines: Object.freeze(next.lines.map((line) => ({ ...line }))),
    });
    return true;
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
