import { Money } from "../finance/money";
import { DomainError, requireDomain } from "../shared/errors";
import type {
  DeactivationFacts,
  PayoutDestination,
} from "../shared/operations";
import type { AccountStatus } from "../shared/statuses";
import type { Region, Sport, UUID } from "../shared/types";
import { PayoutAccount, type PayoutAccountSnapshot } from "./payout-account";

export interface UserSnapshot {
  readonly userId: UUID;
  readonly email: string | null;
  readonly preferredSports: ReadonlySet<Sport>;
  readonly preferredRegions: ReadonlySet<Region>;
  readonly accountStatus: AccountStatus;
  readonly payoutAccount?: PayoutAccountSnapshot;
}

export interface UserRegistration {
  readonly userId: UUID;
  readonly email: string;
  readonly preferredSports?: ReadonlySet<Sport>;
  readonly preferredRegions?: ReadonlySet<Region>;
}

/** User aggregate. Reliability is a derived read model; it is never writable here. */
export class User {
  readonly #userId: UUID;
  #email: string | null;
  #preferredSports: Set<Sport>;
  #preferredRegions: Set<Region>;
  #accountStatus: AccountStatus;
  #payoutAccount?: PayoutAccount;

  private constructor(snapshot: UserSnapshot) {
    this.#userId = snapshot.userId;
    this.#email = snapshot.email;
    this.#preferredSports = new Set(snapshot.preferredSports);
    this.#preferredRegions = new Set(snapshot.preferredRegions);
    this.#accountStatus = snapshot.accountStatus;
    this.#payoutAccount =
      snapshot.payoutAccount === undefined
        ? undefined
        : PayoutAccount.reconstitute(snapshot.payoutAccount);
    this.validate();
  }

  static create(details: UserRegistration): User {
    validateId(details.userId, "userId");
    validateEmail(details.email);
    return new User({
      userId: details.userId,
      email: details.email,
      preferredSports: new Set(details.preferredSports ?? []),
      preferredRegions: new Set(details.preferredRegions ?? []),
      accountStatus: "ACTIVE",
    });
  }

  static reconstitute(snapshot: UserSnapshot): User {
    requireDomain(
      snapshot.preferredSports !== undefined &&
        snapshot.preferredSports !== null &&
        snapshot.preferredRegions !== undefined &&
        snapshot.preferredRegions !== null &&
        typeof snapshot.preferredSports[Symbol.iterator] === "function" &&
        typeof snapshot.preferredRegions[Symbol.iterator] === "function",
      "INVALID_INPUT",
      "A user needs iterable preference sets",
    );
    return new User({
      ...snapshot,
      preferredSports: new Set(snapshot.preferredSports),
      preferredRegions: new Set(snapshot.preferredRegions),
    });
  }

  updateProfile(command: { readonly email: string }): void {
    this.assertActive();
    validateEmail(command.email);
    this.#email = command.email;
  }

  updatePreferences(command: {
    readonly preferredSports: ReadonlySet<Sport>;
    readonly preferredRegions: ReadonlySet<Region>;
  }): void {
    this.assertActive();
    validatePreferences(command.preferredSports, "preferredSports");
    validatePreferences(command.preferredRegions, "preferredRegions");
    this.#preferredSports = new Set(command.preferredSports);
    this.#preferredRegions = new Set(command.preferredRegions);
  }

  beginPayoutSetup(command: {
    readonly payoutAccountId: UUID;
    readonly providerAccountReference: string;
  }): void {
    this.assertActive();
    if (
      this.#payoutAccount?.setupStatus === "PENDING" ||
      this.#payoutAccount?.setupStatus === "COMPLETE"
    ) {
      throw new DomainError(
        "INVALID_STATE",
        "An existing payout setup must finish before it is replaced",
      );
    }
    this.#payoutAccount = PayoutAccount.create({
      ...command,
      userId: this.#userId,
    });
  }

  completePayoutSetup(bankAccountReference: string): void {
    this.assertActive();
    const account = this.#payoutAccount;
    if (account === undefined)
      throw new DomainError(
        "PAYOUT_ACCOUNT_NOT_READY",
        "No payout setup exists",
      );
    this.#payoutAccount = account.completeSetup(bankAccountReference);
  }

  failPayoutSetup(): void {
    this.assertActive();
    const account = this.#payoutAccount;
    if (account === undefined)
      throw new DomainError(
        "PAYOUT_ACCOUNT_NOT_READY",
        "No payout setup exists",
      );
    this.#payoutAccount = account.failSetup();
  }

  payoutDestination(): PayoutDestination {
    this.assertActive();
    const account = this.#payoutAccount;
    if (
      account === undefined ||
      account.setupStatus !== "COMPLETE" ||
      account.bankAccountReference === undefined
    ) {
      throw new DomainError(
        "PAYOUT_ACCOUNT_NOT_READY",
        "Payout setup is not complete",
      );
    }
    return Object.freeze({
      payoutAccountId: account.payoutAccountId,
      userId: this.#userId,
      providerAccountReference: account.providerAccountReference,
      bankAccountReference: account.bankAccountReference,
    });
  }

  deactivate(facts: DeactivationFacts): void {
    if (this.#accountStatus === "INACTIVE") return;
    validateDeactivationFacts(facts);
    requireDomain(
      facts.availableBalance.toCents() === 0 &&
        facts.heldBalance.toCents() === 0 &&
        facts.activeCommitments === 0 &&
        facts.unsettledOwnedSessions === 0 &&
        facts.pendingPayouts === 0 &&
        facts.activeOwnedGroups === 0,
      "ACTIVE_OBLIGATIONS",
      "Outstanding obligations prevent deactivation",
    );
    this.#accountStatus = "INACTIVE";
    this.#email = null;
    this.#preferredSports.clear();
    this.#preferredRegions.clear();
  }

  snapshot(): UserSnapshot {
    return {
      userId: this.#userId,
      email: this.#email,
      preferredSports: new Set(this.#preferredSports),
      preferredRegions: new Set(this.#preferredRegions),
      accountStatus: this.#accountStatus,
      payoutAccount: this.#payoutAccount?.snapshot(),
    };
  }

  get userId(): UUID {
    return this.#userId;
  }
  get email(): string | null {
    return this.#email;
  }
  get preferredSports(): ReadonlySet<Sport> {
    return new Set(this.#preferredSports);
  }
  get preferredRegions(): ReadonlySet<Region> {
    return new Set(this.#preferredRegions);
  }
  get accountStatus(): AccountStatus {
    return this.#accountStatus;
  }
  get payoutAccount(): PayoutAccount | undefined {
    return this.#payoutAccount === undefined
      ? undefined
      : PayoutAccount.reconstitute(this.#payoutAccount.snapshot());
  }

  private assertActive(): void {
    requireDomain(
      this.#accountStatus === "ACTIVE",
      "INACTIVE_ACCOUNT",
      "The account is inactive",
    );
  }

  private validate(): void {
    validateId(this.#userId, "userId");
    requireDomain(
      this.#accountStatus === "ACTIVE" || this.#accountStatus === "INACTIVE",
      "INVALID_INPUT",
      "Unknown account status",
    );
    if (this.#accountStatus === "ACTIVE")
      requireDomain(
        this.#email !== null,
        "INVALID_INPUT",
        "An active account needs an email",
      );
    if (this.#accountStatus === "ACTIVE" && this.#email !== null)
      validateEmail(this.#email);
    if (this.#accountStatus === "INACTIVE")
      requireDomain(
        this.#email === null,
        "INVALID_INPUT",
        "An inactive account must be anonymised",
      );
    validatePreferences(this.#preferredSports, "preferredSports");
    validatePreferences(this.#preferredRegions, "preferredRegions");
    requireDomain(
      this.#payoutAccount === undefined ||
        this.#payoutAccount.userId === this.#userId,
      "INVALID_INPUT",
      "Payout account belongs to another user",
    );
  }
}

function validateId(value: string, name: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
function validateEmail(value: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "" && value.includes("@"),
    "INVALID_INPUT",
    "A valid email is required",
  );
}
function validatePreferences(values: Iterable<string>, name: string): void {
  for (const value of values)
    requireDomain(
      typeof value === "string" && value.trim() !== "",
      "INVALID_INPUT",
      `${name} contains an empty value`,
    );
}
function validateDeactivationFacts(facts: DeactivationFacts): void {
  for (const amount of [facts.availableBalance, facts.heldBalance])
    requireDomain(
      amount instanceof Money,
      "INVALID_INPUT",
      "Balances must be Money values",
    );
  for (const amount of [facts.availableBalance, facts.heldBalance])
    requireDomain(
      amount.toCents() >= 0,
      "INVALID_INPUT",
      "Balances cannot be negative",
    );
  for (const count of [
    facts.activeCommitments,
    facts.unsettledOwnedSessions,
    facts.pendingPayouts,
    facts.activeOwnedGroups,
  ])
    requireDomain(
      Number.isSafeInteger(count) && count >= 0,
      "INVALID_INPUT",
      "Obligation counts must be nonnegative safe integers",
    );
}

export type { DeactivationFacts } from "../shared/operations";
