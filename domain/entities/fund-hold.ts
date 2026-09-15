import { DomainError, requireDomain } from "../errors";
import { copyDate, copyOptionalDate } from "../internal/date";
import type { HoldState } from "../statuses";
import type { UUID } from "../types";
import { Money } from "../value-objects/money";

export interface FundHoldSnapshot {
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
export type FundHoldProps = FundHoldSnapshot;

/** Child entity that protects the lifecycle of one participant's held share. */
export class FundHold {
  readonly #snapshot: FundHoldSnapshot;

  private constructor(snapshot: FundHoldSnapshot) {
    this.#snapshot = Object.freeze({
      ...snapshot,
      createdAt: copyDate(snapshot.createdAt, "createdAt"),
      settledAt: copyOptionalDate(snapshot.settledAt, "settledAt"),
    });
  }

  static create(props: {
    readonly holdId: UUID;
    readonly participationId: UUID;
    readonly holdingAccountId: UUID;
    readonly walletId: UUID;
    readonly amount: Money;
    readonly createdAt: Date;
  }): FundHold {
    requireId(props.holdId, "holdId");
    requireId(props.participationId, "participationId");
    requireId(props.holdingAccountId, "holdingAccountId");
    requireId(props.walletId, "walletId");
    requireDomain(
      props.amount instanceof Money,
      "INVALID_INPUT",
      "A fund hold needs a Money amount",
    );
    requireDomain(
      props.amount.toCents() > 0,
      "INVALID_INPUT",
      "A fund hold must be positive",
    );
    return new FundHold({ ...props, state: "HELD" });
  }

  static reconstitute(snapshot: FundHoldSnapshot): FundHold {
    requireId(snapshot.holdId, "holdId");
    requireId(snapshot.participationId, "participationId");
    requireId(snapshot.holdingAccountId, "holdingAccountId");
    requireId(snapshot.walletId, "walletId");
    requireDomain(
      [
        "HELD",
        "AWAITING_REPLACEMENT",
        "FORFEITURE_DUE",
        "RELEASED",
        "REFUNDED",
        "FORFEITED",
      ].includes(snapshot.state),
      "INVALID_INPUT",
      "Unknown hold state",
    );
    requireDomain(
      snapshot.amount instanceof Money,
      "INVALID_INPUT",
      "A fund hold needs a Money amount",
    );
    requireDomain(
      snapshot.amount.toCents() > 0,
      "INVALID_INPUT",
      "A fund hold must be positive",
    );
    const createdAt = copyDate(snapshot.createdAt, "createdAt");
    const settledAt = copyOptionalDate(snapshot.settledAt, "settledAt");
    const terminal = ["REFUNDED", "RELEASED", "FORFEITED"].includes(
      snapshot.state,
    );
    if (terminal) {
      requireDomain(
        settledAt !== undefined,
        "INVALID_INPUT",
        "A settled hold needs settledAt",
      );
      if (snapshot.state !== "REFUNDED") {
        requireDomain(
          snapshot.payoutId !== undefined,
          "INVALID_INPUT",
          "A payout settlement needs payoutId",
        );
      } else {
        requireDomain(
          snapshot.payoutId === undefined,
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
        snapshot.payoutId === undefined,
        "INVALID_INPUT",
        "An active hold cannot have payoutId",
      );
    }
    return new FundHold({ ...snapshot, createdAt, settledAt });
  }

  snapshot(): FundHoldSnapshot {
    return {
      ...this.#snapshot,
      createdAt: copyDate(this.#snapshot.createdAt, "createdAt"),
      settledAt: copyOptionalDate(this.#snapshot.settledAt, "settledAt"),
    };
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
    return this.#snapshot.holdId;
  }
  get participationId(): UUID {
    return this.#snapshot.participationId;
  }
  get holdingAccountId(): UUID {
    return this.#snapshot.holdingAccountId;
  }
  get walletId(): UUID {
    return this.#snapshot.walletId;
  }
  get payoutId(): UUID | undefined {
    return this.#snapshot.payoutId;
  }
  get amount(): Money {
    return this.#snapshot.amount;
  }
  get state(): HoldState {
    return this.#snapshot.state;
  }
  get createdAt(): Date {
    return copyDate(this.#snapshot.createdAt, "createdAt");
  }
  get settledAt(): Date | undefined {
    return copyOptionalDate(this.#snapshot.settledAt, "settledAt");
  }

  private requireActive(): void {
    if (["REFUNDED", "RELEASED", "FORFEITED"].includes(this.state)) {
      throw new DomainError("INVALID_STATE", "A terminal hold cannot change");
    }
  }

  private withState(state: HoldState): FundHold {
    return new FundHold({ ...this.snapshot(), state });
  }

  private withSettlement(
    state: HoldState,
    payoutId: UUID | undefined,
    at: Date,
  ): FundHold {
    return new FundHold({
      ...this.snapshot(),
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
