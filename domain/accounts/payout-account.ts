import { DomainError, requireDomain } from "../shared/errors";
import type { PayoutSetupStatus } from "../shared/statuses";
import type { UUID } from "../shared/types";

export interface PayoutAccountSnapshot {
  readonly payoutAccountId: UUID;
  readonly userId: UUID;
  readonly providerAccountReference: string;
  readonly bankAccountReference?: string;
  readonly setupStatus: PayoutSetupStatus;
}

/** Immutable child containing the destination frozen for future settlements. */
export class PayoutAccount {
  readonly #snapshot: PayoutAccountSnapshot;

  private constructor(snapshot: PayoutAccountSnapshot) {
    this.#snapshot = Object.freeze({ ...snapshot });
  }

  static create(details: {
    readonly payoutAccountId: UUID;
    readonly userId: UUID;
    readonly providerAccountReference: string;
  }): PayoutAccount {
    validateText(details.payoutAccountId, "payoutAccountId");
    validateText(details.userId, "userId");
    validateText(details.providerAccountReference, "providerAccountReference");
    return new PayoutAccount({ ...details, setupStatus: "PENDING" });
  }

  static reconstitute(snapshot: PayoutAccountSnapshot): PayoutAccount {
    validateText(snapshot.payoutAccountId, "payoutAccountId");
    validateText(snapshot.userId, "userId");
    validateText(snapshot.providerAccountReference, "providerAccountReference");
    requireDomain(
      ["PENDING", "COMPLETE", "FAILED"].includes(snapshot.setupStatus),
      "INVALID_INPUT",
      "Unknown payout setup status",
    );
    if (snapshot.setupStatus === "COMPLETE") {
      validateText(snapshot.bankAccountReference, "bankAccountReference");
    } else {
      requireDomain(
        snapshot.bankAccountReference === undefined,
        "INVALID_INPUT",
        "Only a completed payout account has bank details",
      );
    }
    return new PayoutAccount({ ...snapshot });
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
    requireDomain(
      this.setupStatus === "PENDING",
      "INVALID_STATE",
      "Only a pending payout setup can complete",
    );
    return PayoutAccount.reconstitute({
      ...this.snapshot(),
      setupStatus: "COMPLETE",
      bankAccountReference,
    });
  }

  failSetup(): PayoutAccount {
    requireDomain(
      this.setupStatus === "PENDING",
      "INVALID_STATE",
      "Only a pending payout setup can fail",
    );
    return PayoutAccount.reconstitute({
      ...this.snapshot(),
      setupStatus: "FAILED",
    });
  }

  snapshot(): PayoutAccountSnapshot {
    return { ...this.#snapshot };
  }
  get payoutAccountId(): UUID {
    return this.#snapshot.payoutAccountId;
  }
  get userId(): UUID {
    return this.#snapshot.userId;
  }
  get providerAccountReference(): string {
    return this.#snapshot.providerAccountReference;
  }
  get bankAccountReference(): string | undefined {
    return this.#snapshot.bankAccountReference;
  }
  get setupStatus(): PayoutSetupStatus {
    return this.#snapshot.setupStatus;
  }
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
