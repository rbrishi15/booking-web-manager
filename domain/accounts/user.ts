import { Wallet } from "../finance/wallet";
import { ReliabilityScore } from "../reliability/reliability-score";
import { DomainError } from "../shared/errors";
import type {
  DeactivationInput,
  PayoutDestination,
} from "../shared/operations";
import type { AccountStatus } from "../shared/statuses";
import type { Region, Sport, UUID } from "../shared/types";
import { Booker } from "./booker";
import { Email } from "./email";
import { Participant } from "./participant";
import { PayoutAccount } from "./payout-account";

export interface UserDetails {
  readonly userId: UUID;
  readonly email: Email | null;
  readonly preferredSports: ReadonlySet<Sport>;
  readonly preferredRegions: ReadonlySet<Region>;
  readonly accountStatus: AccountStatus;
  readonly payoutAccount?: PayoutAccount;
  readonly wallet: Wallet;
  readonly reliabilityScore: ReliabilityScore;
  readonly memberGroupIds: readonly UUID[];
}

export interface UserRegistration {
  readonly userId: UUID;
  readonly email: Email;
  readonly walletId: UUID;
  readonly now: Date;
  readonly preferredSports?: ReadonlySet<Sport>;
  readonly preferredRegions?: ReadonlySet<Region>;
}

/**
 * Aggregate root: User.
 * Owns profile, preferences, account status, Wallet, and PayoutAccount children.
 * Profile, deactivation, and payout-setup commands enter through this root;
 * payout-setup transitions replace its immutable child.
 * Booker and Participant are role views. Wallet derives funds from its loaded
 * transactions; reliability and memberships are read-only related values.
 * Ledger writes, participation history, and groups remain external. Reload
 * after those sources change.
 * See docs/adr/0003-aggregate-roots-and-boundaries.md.
 */
export class User {
  readonly #userId: UUID;
  #email: Email | null;
  #preferredSports: Set<Sport>;
  #preferredRegions: Set<Region>;
  #accountStatus: AccountStatus;
  #payoutAccount?: PayoutAccount;
  readonly #wallet: Wallet;
  readonly #reliabilityScore: ReliabilityScore;
  readonly #memberGroupIds: readonly UUID[];

  constructor(details: UserDetails) {
    validateRelatedData(details);
    const hasPreferenceSets =
      details.preferredSports !== undefined &&
      details.preferredSports !== null &&
      details.preferredRegions !== undefined &&
      details.preferredRegions !== null;
    DomainError.require(
      hasPreferenceSets,
      "INVALID_INPUT",
      "A user needs iterable preference sets",
    );

    this.#userId = details.userId;
    this.#email = details.email;
    this.#preferredSports = new Set(details.preferredSports);
    this.#preferredRegions = new Set(details.preferredRegions);
    this.#accountStatus = details.accountStatus;
    this.#payoutAccount = details.payoutAccount;
    this.#wallet = details.wallet;
    this.#reliabilityScore = details.reliabilityScore;
    this.#memberGroupIds = [...details.memberGroupIds];
    this.assertInvariants();
  }

  static create(details: UserRegistration): User {
    return new User({
      userId: details.userId,
      email: details.email,
      preferredSports: details.preferredSports ?? new Set(),
      preferredRegions: details.preferredRegions ?? new Set(),
      accountStatus: "ACTIVE",
      wallet: new Wallet({
        walletId: details.walletId,
        userId: details.userId,
        transactions: [],
      }),
      reliabilityScore: ReliabilityScore.fromHistory(
        details.userId,
        [],
        details.now,
      ),
      memberGroupIds: [],
    });
  }

  updateProfile(command: { readonly email: Email }): void {
    this.assertActive();
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

  deactivate(input: DeactivationInput): void {
    if (this.#accountStatus === "INACTIVE") return;
    validateDeactivationInput(input);
    const hasNoOutstandingObligations =
      input.availableBalance.toCents() === 0 &&
      input.heldBalance.toCents() === 0 &&
      input.activeCommitments === 0 &&
      input.unsettledOwnedSessions === 0 &&
      input.pendingPayouts === 0 &&
      input.activeOwnedGroups === 0;
    DomainError.require(
      hasNoOutstandingObligations,
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
  get email(): Email | null {
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
  get wallet(): Wallet {
    return this.#wallet;
  }
  get reliabilityScore(): ReliabilityScore {
    return this.#reliabilityScore;
  }
  get memberGroupIds(): readonly UUID[] {
    return [...this.#memberGroupIds];
  }

  private assertActive(): void {
    DomainError.require(
      this.#accountStatus === "ACTIVE",
      "INACTIVE_ACCOUNT",
      "The account is inactive",
    );
  }

  private assertInvariants(): void {
    validateId(this.#userId, "userId");
    DomainError.require(
      this.#accountStatus === "ACTIVE" || this.#accountStatus === "INACTIVE",
      "INVALID_INPUT",
      "Unknown account status",
    );
    if (this.#accountStatus === "ACTIVE")
      DomainError.require(
        this.#email !== null,
        "INVALID_INPUT",
        "An active account needs an Email",
      );
    if (this.#accountStatus === "INACTIVE")
      DomainError.require(
        this.#email === null,
        "INVALID_INPUT",
        "An inactive account must be anonymised",
      );
    validatePreferences(this.#preferredSports, "preferredSports");
    validatePreferences(this.#preferredRegions, "preferredRegions");
    DomainError.require(
      this.#payoutAccount === undefined ||
        this.#payoutAccount.userId === this.#userId,
      "INVALID_INPUT",
      "Payout account belongs to another user",
    );
  }
}

function validateRelatedData(details: UserDetails): void {
  DomainError.require(
    details.wallet.userId === details.userId,
    "INVALID_INPUT",
    "A user needs a wallet belonging to that user",
  );
  DomainError.require(
    Array.isArray(details.memberGroupIds) &&
      details.memberGroupIds.every((id) => id.trim() !== ""),
    "INVALID_INPUT",
    "A user needs valid group membership IDs",
  );
}

function validateId(value: string, name: string): void {
  DomainError.require(
    value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
function validatePreferences(values: Iterable<string>, name: string): void {
  for (const value of values)
    DomainError.require(
      value.trim() !== "",
      "INVALID_INPUT",
      `${name} contains an empty value`,
    );
}
function validateDeactivationInput(input: DeactivationInput): void {
  for (const amount of [input.availableBalance, input.heldBalance])
    DomainError.require(
      amount.toCents() >= 0,
      "INVALID_INPUT",
      "Balances cannot be negative",
    );
  for (const count of [
    input.activeCommitments,
    input.unsettledOwnedSessions,
    input.pendingPayouts,
    input.activeOwnedGroups,
  ])
    DomainError.require(
      Number.isSafeInteger(count) && count >= 0,
      "INVALID_INPUT",
      "Obligation counts must be nonnegative safe integers",
    );
}

export type { DeactivationInput } from "../shared/operations";
