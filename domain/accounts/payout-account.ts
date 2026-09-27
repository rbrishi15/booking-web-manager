import { DomainError } from "../shared/errors";
import type { PayoutSetupStatus } from "../shared/statuses";
import type { UUID } from "../shared/types";

export interface PayoutAccountDetails {
  readonly payoutAccountId: UUID;
  readonly userId: UUID;
  readonly providerAccountReference: string;
  readonly bankAccountReference?: string;
  readonly setupStatus: PayoutSetupStatus;
}

/**
 * Immutable child entity of the User aggregate root.
 * User commands apply payout-setup changes by replacing this child. Calling a
 * child transition returns a new value without changing the owning User.
 */
export class PayoutAccount {
  readonly #payoutAccountId: UUID;
  readonly #userId: UUID;
  readonly #providerAccountReference: string;
  readonly #bankAccountReference?: string;
  readonly #setupStatus: PayoutSetupStatus;

  constructor(details: PayoutAccountDetails) {
    validateText(details.payoutAccountId, "payoutAccountId");
    validateText(details.userId, "userId");
    validateText(details.providerAccountReference, "providerAccountReference");
    DomainError.require(
      ["PENDING", "COMPLETE", "FAILED"].includes(details.setupStatus),
      "INVALID_INPUT",
      "Unknown payout setup status",
    );
    if (details.setupStatus === "COMPLETE") {
      validateText(details.bankAccountReference, "bankAccountReference");
    } else {
      DomainError.require(
        details.bankAccountReference === undefined,
        "INVALID_INPUT",
        "Only a completed payout account has bank details",
      );
    }

    this.#payoutAccountId = details.payoutAccountId;
    this.#userId = details.userId;
    this.#providerAccountReference = details.providerAccountReference;
    this.#bankAccountReference = details.bankAccountReference;
    this.#setupStatus = details.setupStatus;
  }

  static create(details: {
    readonly payoutAccountId: UUID;
    readonly userId: UUID;
    readonly providerAccountReference: string;
  }): PayoutAccount {
    return new PayoutAccount({ ...details, setupStatus: "PENDING" });
  }

  completeSetup(bankAccountReference: string): PayoutAccount {
    validateText(bankAccountReference, "bankAccountReference");
    if (this.setupStatus === "COMPLETE") {
      if (this.bankAccountReference === bankAccountReference) return this;
      throw new DomainError(
        "INVALID_STATE",
        "A completed payout destination cannot be changed",
      );
    }
    DomainError.require(
      this.setupStatus === "PENDING",
      "INVALID_STATE",
      "Only a pending payout setup can complete",
    );
    return new PayoutAccount({
      payoutAccountId: this.#payoutAccountId,
      userId: this.#userId,
      providerAccountReference: this.#providerAccountReference,
      setupStatus: "COMPLETE",
      bankAccountReference,
    });
  }

  failSetup(): PayoutAccount {
    DomainError.require(
      this.setupStatus === "PENDING",
      "INVALID_STATE",
      "Only a pending payout setup can fail",
    );
    return new PayoutAccount({
      payoutAccountId: this.#payoutAccountId,
      userId: this.#userId,
      providerAccountReference: this.#providerAccountReference,
      setupStatus: "FAILED",
    });
  }

  get payoutAccountId(): UUID {
    return this.#payoutAccountId;
  }
  get userId(): UUID {
    return this.#userId;
  }
  get providerAccountReference(): string {
    return this.#providerAccountReference;
  }
  get bankAccountReference(): string | undefined {
    return this.#bankAccountReference;
  }
  get setupStatus(): PayoutSetupStatus {
    return this.#setupStatus;
  }
}

function validateText(
  value: string | undefined,
  name: string,
): asserts value is string {
  DomainError.require(
    value !== undefined && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
