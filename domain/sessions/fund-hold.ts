import { Money } from "../finance/money";
import { copyDate, copyOptionalDate } from "../shared/date";
import { DomainError, requireDomain } from "../shared/errors";
import type { HoldState } from "../shared/statuses";
import type { UUID } from "../shared/types";

export interface FundHoldDetails {
  readonly holdId: UUID;
  readonly participationId: UUID;
  readonly holdingAccountId: UUID;
  readonly walletId: UUID;
  readonly payoutId?: UUID;
  readonly amount: Money;
  readonly state: HoldState;
  readonly createdAt: Date;
  readonly settledAt?: Date;
}

/**
 * Immutable child entity owned by Participation within the Session aggregate.
 * Protects the lifecycle of one participant's held share. Transitions return new
 * holds; Session commands apply the resulting participation changes and return
 * financial instructions for the application layer to coordinate.
 */
export class FundHold {
  readonly #holdId: UUID;
  readonly #participationId: UUID;
  readonly #holdingAccountId: UUID;
  readonly #walletId: UUID;
  readonly #payoutId?: UUID;
  readonly #amount: Money;
  readonly #state: HoldState;
  readonly #createdAt: Date;
  readonly #settledAt?: Date;

  constructor(details: FundHoldDetails) {
    requireId(details.holdId, "holdId");
    requireId(details.participationId, "participationId");
    requireId(details.holdingAccountId, "holdingAccountId");
    requireId(details.walletId, "walletId");
    if (details.payoutId !== undefined) requireId(details.payoutId, "payoutId");
    requireDomain(
      [
        "HELD",
        "AWAITING_REPLACEMENT",
        "FORFEITURE_DUE",
        "RELEASED",
        "REFUNDED",
        "FORFEITED",
      ].includes(details.state),
      "INVALID_INPUT",
      "Unknown hold state",
    );
    requireDomain(
      details.amount instanceof Money,
      "INVALID_INPUT",
      "A fund hold needs a Money amount",
    );
    requireDomain(
      details.amount.toCents() > 0,
      "INVALID_INPUT",
      "A fund hold must be positive",
    );
    const createdAt = copyDate(details.createdAt, "createdAt");
    const settledAt = copyOptionalDate(details.settledAt, "settledAt");
    const terminal = ["REFUNDED", "RELEASED", "FORFEITED"].includes(
      details.state,
    );
    if (terminal) {
      requireDomain(
        settledAt !== undefined,
        "INVALID_INPUT",
        "A settled hold needs settledAt",
      );
      if (details.state !== "REFUNDED") {
        requireDomain(
          details.payoutId !== undefined,
          "INVALID_INPUT",
          "A payout settlement needs payoutId",
        );
      } else {
        requireDomain(
          details.payoutId === undefined,
          "INVALID_INPUT",
          "A refund cannot have a payout ID",
        );
      }
    } else {
      requireDomain(
        settledAt === undefined,
        "INVALID_INPUT",
        "An active hold cannot have settledAt",
      );
      requireDomain(
        details.payoutId === undefined,
        "INVALID_INPUT",
        "An active hold cannot have payoutId",
      );
    }

    this.#holdId = details.holdId;
    this.#participationId = details.participationId;
    this.#holdingAccountId = details.holdingAccountId;
    this.#walletId = details.walletId;
    this.#payoutId = details.payoutId;
    this.#amount = details.amount;
    this.#state = details.state;
    this.#createdAt = createdAt;
    this.#settledAt = settledAt;
  }

  static create(details: {
    readonly holdId: UUID;
    readonly participationId: UUID;
    readonly holdingAccountId: UUID;
    readonly walletId: UUID;
    readonly amount: Money;
    readonly createdAt: Date;
  }): FundHold {
    return new FundHold({ ...details, state: "HELD" });
  }

  awaitReplacement(): FundHold {
    this.requireActive();
    if (this.state !== "HELD") {
      throw new DomainError(
        "INVALID_STATE",
        "Only a held fund can await replacement",
      );
    }
    return this.withState("AWAITING_REPLACEMENT");
  }

  markForfeitureDue(at: Date): FundHold {
    this.requireActive();
    if (this.state !== "AWAITING_REPLACEMENT") {
      throw new DomainError(
        "INVALID_STATE",
        "Only a replacement hold can become forfeiture due",
      );
    }
    copyDate(at, "at");
    return this.withState("FORFEITURE_DUE");
  }

  refund(at: Date): FundHold {
    this.requireActive();
    copyDate(at, "at");
    if (
      !["HELD", "AWAITING_REPLACEMENT", "FORFEITURE_DUE"].includes(this.state)
    ) {
      throw new DomainError(
        "INVALID_STATE",
        "This hold has already been settled",
      );
    }
    return this.withSettlement("REFUNDED", undefined, at);
  }

  release(payoutId: UUID, at: Date): FundHold {
    this.requireActive();
    requireDomain(
      typeof payoutId === "string" && payoutId.trim() !== "",
      "INVALID_INPUT",
      "A release needs a payout ID",
    );
    if (this.state !== "HELD") {
      throw new DomainError("INVALID_STATE", "This hold cannot be released");
    }
    return this.withSettlement("RELEASED", payoutId, at);
  }

  forfeit(payoutId: UUID, at: Date): FundHold {
    this.requireActive();
    requireDomain(
      typeof payoutId === "string" && payoutId.trim() !== "",
      "INVALID_INPUT",
      "A forfeiture needs a payout ID",
    );
    if (!["HELD", "FORFEITURE_DUE"].includes(this.state)) {
      throw new DomainError(
        "INVALID_STATE",
        "Only an unsettled hold can be forfeited",
      );
    }
    return this.withSettlement("FORFEITED", payoutId, at);
  }

  get holdId(): UUID {
    return this.#holdId;
  }
  get participationId(): UUID {
    return this.#participationId;
  }
  get holdingAccountId(): UUID {
    return this.#holdingAccountId;
  }
  get walletId(): UUID {
    return this.#walletId;
  }
  get payoutId(): UUID | undefined {
    return this.#payoutId;
  }
  get amount(): Money {
    return this.#amount;
  }
  get state(): HoldState {
    return this.#state;
  }
  get createdAt(): Date {
    return copyDate(this.#createdAt, "createdAt");
  }
  get settledAt(): Date | undefined {
    return copyOptionalDate(this.#settledAt, "settledAt");
  }

  private requireActive(): void {
    if (["REFUNDED", "RELEASED", "FORFEITED"].includes(this.state)) {
      throw new DomainError("INVALID_STATE", "A terminal hold cannot change");
    }
  }

  private withState(state: HoldState): FundHold {
    return new FundHold({
      holdId: this.#holdId,
      participationId: this.#participationId,
      holdingAccountId: this.#holdingAccountId,
      walletId: this.#walletId,
      payoutId: this.#payoutId,
      amount: this.#amount,
      createdAt: this.#createdAt,
      settledAt: this.#settledAt,
      state,
    });
  }

  private withSettlement(
    state: HoldState,
    payoutId: UUID | undefined,
    at: Date,
  ): FundHold {
    return new FundHold({
      holdId: this.#holdId,
      participationId: this.#participationId,
      holdingAccountId: this.#holdingAccountId,
      walletId: this.#walletId,
      amount: this.#amount,
      createdAt: this.#createdAt,
      state,
      payoutId,
      settledAt: copyDate(at, "at"),
    });
  }
}

function requireId(value: string, name: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
