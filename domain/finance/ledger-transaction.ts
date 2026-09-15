import { copyDate } from "../shared/date";
import { requireDomain } from "../shared/errors";
import type { TransactionKind } from "../shared/statuses";
import type { UUID } from "../shared/types";
import { Money } from "./money";

export interface LedgerTransactionSnapshot {
  readonly transactionId: UUID;
  readonly amount: Money;
  readonly kind: TransactionKind;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
  readonly externalReference?: string;
  readonly walletId?: UUID;
  readonly holdId?: UUID;
  readonly payoutId?: UUID;
}

/** Immutable financial fact. Append-only persistence is enforced by the server adapter. */
export class LedgerTransaction {
  readonly #snapshot: LedgerTransactionSnapshot;
  private constructor(snapshot: LedgerTransactionSnapshot) {
    this.#snapshot = Object.freeze({
      ...snapshot,
      occurredAt: copyDate(snapshot.occurredAt, "occurredAt"),
    });
  }

  static create(details: LedgerTransactionSnapshot): LedgerTransaction {
    validate(details);
    return new LedgerTransaction(details);
  }
  static reconstitute(snapshot: LedgerTransactionSnapshot): LedgerTransaction {
    return LedgerTransaction.create(snapshot);
  }
  snapshot(): LedgerTransactionSnapshot {
    return {
      ...this.#snapshot,
      occurredAt: copyDate(this.#snapshot.occurredAt, "occurredAt"),
    };
  }
  get transactionId(): UUID {
    return this.#snapshot.transactionId;
  }
  get amount(): Money {
    return this.#snapshot.amount;
  }
  get kind(): TransactionKind {
    return this.#snapshot.kind;
  }
  get occurredAt(): Date {
    return copyDate(this.#snapshot.occurredAt, "occurredAt");
  }
  get idempotencyKey(): string {
    return this.#snapshot.idempotencyKey;
  }
  get externalReference(): string | undefined {
    return this.#snapshot.externalReference;
  }
  get walletId(): UUID | undefined {
    return this.#snapshot.walletId;
  }
  get holdId(): UUID | undefined {
    return this.#snapshot.holdId;
  }
  get payoutId(): UUID | undefined {
    return this.#snapshot.payoutId;
  }
}

function validate(details: LedgerTransactionSnapshot): void {
  requireDomain(
    typeof details.transactionId === "string" &&
      details.transactionId.trim() !== "",
    "INVALID_INPUT",
    "transactionId is required",
  );
  requireDomain(
    details.amount instanceof Money,
    "INVALID_INPUT",
    "Ledger transaction amount must be Money",
  );
  requireDomain(
    details.amount.toCents() > 0,
    "INVALID_INPUT",
    "Ledger transaction amount must be positive",
  );
  requireDomain(
    ["TOP_UP", "LOCK", "RELEASE", "REFUND", "FORFEIT", "PAYOUT"].includes(
      details.kind,
    ),
    "INVALID_INPUT",
    "Unknown transaction kind",
  );
  requireDomain(
    typeof details.idempotencyKey === "string" &&
      details.idempotencyKey.trim() !== "",
    "INVALID_INPUT",
    "idempotencyKey is required",
  );
  copyDate(details.occurredAt, "occurredAt");
  for (const id of [
    details.walletId,
    details.holdId,
    details.payoutId,
    details.externalReference,
  ])
    if (id !== undefined)
      requireDomain(
        typeof id === "string" && id.trim() !== "",
        "INVALID_INPUT",
        "References cannot be empty",
      );
}
