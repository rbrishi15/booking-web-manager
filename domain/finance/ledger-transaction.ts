import { copyDate } from "../shared/date";
import { DomainError } from "../shared/errors";
import type { TransactionKind } from "../shared/statuses";
import type { UUID } from "../shared/types";
import { Money } from "./money";

export interface LedgerTransactionDetails {
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

/**
 * Immutable financial fact, not an aggregate root in the current model.
 * Validates a single ledger entry; append-only and cross-entry financial
 * consistency are enforced by the server's ledger adapter.
 */
export class LedgerTransaction {
  readonly #transactionId: UUID;
  readonly #amount: Money;
  readonly #kind: TransactionKind;
  readonly #occurredAt: Date;
  readonly #idempotencyKey: string;
  readonly #externalReference?: string;
  readonly #walletId?: UUID;
  readonly #holdId?: UUID;
  readonly #payoutId?: UUID;
  constructor(details: LedgerTransactionDetails) {
    validate(details);

    this.#transactionId = details.transactionId;
    this.#amount = details.amount;
    this.#kind = details.kind;
    this.#occurredAt = copyDate(details.occurredAt, "occurredAt");
    this.#idempotencyKey = details.idempotencyKey;
    this.#externalReference = details.externalReference;
    this.#walletId = details.walletId;
    this.#holdId = details.holdId;
    this.#payoutId = details.payoutId;
  }

  get transactionId(): UUID {
    return this.#transactionId;
  }
  get amount(): Money {
    return this.#amount;
  }
  get kind(): TransactionKind {
    return this.#kind;
  }
  get occurredAt(): Date {
    return copyDate(this.#occurredAt, "occurredAt");
  }
  get idempotencyKey(): string {
    return this.#idempotencyKey;
  }
  get externalReference(): string | undefined {
    return this.#externalReference;
  }
  get walletId(): UUID | undefined {
    return this.#walletId;
  }
  get holdId(): UUID | undefined {
    return this.#holdId;
  }
  get payoutId(): UUID | undefined {
    return this.#payoutId;
  }
}

function validate(details: LedgerTransactionDetails): void {
  DomainError.require(
    details.transactionId.trim() !== "",
    "INVALID_INPUT",
    "transactionId is required",
  );
  DomainError.require(
    details.amount.toCents() > 0,
    "INVALID_INPUT",
    "Ledger transaction amount must be positive",
  );
  DomainError.require(
    ["TOP_UP", "LOCK", "RELEASE", "REFUND", "FORFEIT", "PAYOUT"].includes(
      details.kind,
    ),
    "INVALID_INPUT",
    "Unknown transaction kind",
  );
  DomainError.require(
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
      DomainError.require(
        id.trim() !== "",
        "INVALID_INPUT",
        "References cannot be empty",
      );
}
