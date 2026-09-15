import { Money } from "../finance/money";
import { DomainError, requireDomain } from "../shared/errors";
import type {
  DeactivationFacts,
  PayoutDestination,
} from "../shared/operations";
import type { AccountStatus } from "../shared/statuses";
import type { Region, Sport, UUID } from "../shared/types";
import { Booker } from "./booker";
import { Participant } from "./participant";
import { PayoutAccount } from "./payout-account";

export interface UserDetails {
  readonly userId: UUID;
  readonly email: string | null;
  readonly preferredSports: ReadonlySet<Sport>;
  readonly preferredRegions: ReadonlySet<Region>;
  readonly accountStatus: AccountStatus;
  readonly payoutAccount?: PayoutAccount;
}

export interface UserRegistration {
  readonly userId: UUID;
  readonly email: string;
  readonly preferredSports?: ReadonlySet<Sport>;
  readonly preferredRegions?: ReadonlySet<Region>;
}

/**
 * Aggregate root: User.
 * Owns profile, preferences, account status, and the PayoutAccount child.
 * Profile, deactivation, and payout-setup commands enter through this root;
 * payout-setup transitions replace its immutable child.
 * Booker and Participant are role views. Reliability and wallet balances are
 * external, derived facts rather than state owned by this aggregate.
 * See docs/adr/0003-aggregate-roots-and-boundaries.md.
 */
export class User {
  readonly #userId: UUID;
  #email: string | null;
  #preferredSports: Set<Sport>;
  #preferredRegions: Set<Region>;
  #accountStatus: AccountStatus;
  #payoutAccount?: PayoutAccount;

  constructor(details: UserDetails) {
    requireDomain(
      details.preferredSports !== undefined &&
        details.preferredSports !== null &&
        details.preferredRegions !== undefined &&
        details.preferredRegions !== null &&
        typeof details.preferredSports[Symbol.iterator] === "function" &&
        typeof details.preferredRegions[Symbol.iterator] === "function",
      "INVALID_INPUT",
      "A user needs iterable preference sets",
    );

    requireDomain(
      details.payoutAccount === undefined ||
        details.payoutAccount instanceof PayoutAccount,
      "INVALID_INPUT",
      "A payout account must be a PayoutAccount",
    );
    this.#userId = details.userId;
    this.#email = details.email;
    this.#preferredSports = new Set(details.preferredSports);
    this.#preferredRegions = new Set(details.preferredRegions);
    this.#accountStatus = details.accountStatus;
    this.#payoutAccount = details.payoutAccount;
    this.validate();
  }

  static create(details: UserRegistration): User {
    return new User({
      userId: details.userId,
      email: details.email,
      preferredSports: details.preferredSports ?? new Set(),
      preferredRegions: details.preferredRegions ?? new Set(),
      accountStatus: "ACTIVE",
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

  /** Enter the booker role for commands on sessions owned by this user. */
  asBooker(): Booker {
    return Booker.for(this);
  }

  /** Enter the participant role for joining and leaving sessions. */
  asParticipant(): Participant {
    return Participant.for(this);
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
    return this.#payoutAccount;
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
