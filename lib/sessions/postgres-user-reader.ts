import {
  Email,
  FundHold,
  LedgerTransaction,
  Participation,
  PayoutAccount,
  ReliabilityScore,
  User,
  Wallet,
  type UUID,
} from "@/domain";
import { fromDatabaseCents } from "@/lib/money/cents";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";
import type { Clock } from "@/use-cases/shared/contracts";
import {
  choice,
  date,
  optionalDate,
  optionalInteger,
  optionalText,
  SessionPersistenceError,
  strings,
  text,
} from "./postgres-row-values";

export class PostgresUserReader {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly clock: Clock,
  ) {}

  async get(userId: UUID): Promise<User | null> {
    const profiles = await this.sql.query(
      `select p.user_id, p.account_status, p.preferred_sports, p.preferred_regions, u.email
       from profiles p join auth.users u on u.id = p.user_id
       where p.user_id = $1 for share of p, u`,
      [userId],
    );
    const profile = profiles[0];
    if (profile === undefined) return null;
    const payouts = await this.sql.query(
      `select payout_account_id, user_id, provider_account_reference, bank_account_reference, setup_status
       from payout_accounts where user_id = $1 for share`,
      [userId],
    );
    const wallets = await this.sql.query(
      "select wallet_id, user_id from wallets where user_id = $1",
      [userId],
    );
    const wallet = wallets[0];
    if (wallet === undefined)
      throw new SessionPersistenceError("Stored user has no wallet");
    const walletId = text(wallet.wallet_id);
    // The paginated UI ledger reader cannot supply a complete aggregate history.
    const entries = await this.sql.query(
      `select entry_id, amount_cents, kind, occurred_at, idempotency_key, external_reference, wallet_id, hold_id, payout_id
       from ledger_entries where wallet_id = $1 order by occurred_at, entry_id`,
      [walletId],
    );
    const memberships = await this.sql.query(
      "select group_id from group_memberships where user_id = $1 order by group_id",
      [userId],
    );
    const history = await this.sql.query(
      `select p.*, s.end_at, h.hold_id, h.participation_id as hold_participation_id,
              h.holding_account_id, h.wallet_id, h.payout_id, h.amount_cents,
              h.state as hold_state, h.created_at as hold_created_at, h.settled_at
       from participations p join sessions s on s.session_id = p.session_id
       left join fund_holds h on h.participation_id = p.participation_id
       where p.user_id = $1 order by p.participation_id`,
      [userId],
    );
    // Keep SQL failures outside this wrapper so transaction retries retain SQLSTATEs.
    try {
      const status = choice(profile.account_status, ["ACTIVE", "INACTIVE"]);
      return new User({
        userId: text(profile.user_id),
        accountStatus: status,
        email: status === "INACTIVE" ? null : new Email(text(profile.email)),
        preferredSports: new Set(strings(profile.preferred_sports)),
        preferredRegions: new Set(strings(profile.preferred_regions)),
        payoutAccount:
          payouts[0] === undefined ? undefined : hydratePayout(payouts[0]),
        wallet: new Wallet({
          walletId,
          userId: text(wallet.user_id),
          transactions: entries.map(hydrateEntry),
        }),
        memberGroupIds: memberships.map((row) => text(row.group_id)),
        reliabilityScore: ReliabilityScore.fromHistory(
          userId,
          history.map((row) => ({
            participation: hydrateParticipation(row, walletId),
            endAt: date(row.end_at),
          })),
          this.clock.now(),
        ),
      });
    } catch (cause) {
      throw new SessionPersistenceError(
        "Stored user state could not be hydrated",
        { cause },
      );
    }
  }
}

function hydratePayout(row: SqlRow): PayoutAccount {
  return new PayoutAccount({
    payoutAccountId: text(row.payout_account_id),
    userId: text(row.user_id),
    providerAccountReference: text(row.provider_account_reference),
    bankAccountReference: optionalText(row.bank_account_reference),
    setupStatus: choice(row.setup_status, ["PENDING", "COMPLETE", "FAILED"]),
  });
}

function hydrateEntry(row: SqlRow): LedgerTransaction {
  return new LedgerTransaction({
    transactionId: text(row.entry_id),
    amount: fromDatabaseCents(row.amount_cents, "amount_cents"),
    kind: choice(row.kind, [
      "TOP_UP",
      "LOCK",
      "RELEASE",
      "REFUND",
      "FORFEIT",
      "PAYOUT",
    ]),
    occurredAt: date(row.occurred_at),
    idempotencyKey: text(row.idempotency_key),
    externalReference: optionalText(row.external_reference),
    walletId: optionalText(row.wallet_id),
    holdId: optionalText(row.hold_id),
    payoutId: optionalText(row.payout_id),
  });
}

function hydrateParticipation(row: SqlRow, walletId: UUID): Participation {
  const hold =
    row.hold_id === null
      ? undefined
      : new FundHold({
          holdId: text(row.hold_id),
          participationId: text(row.hold_participation_id),
          holdingAccountId: text(row.holding_account_id),
          walletId: text(row.wallet_id),
          payoutId: optionalText(row.payout_id),
          amount: fromDatabaseCents(row.amount_cents, "amount_cents"),
          state: choice(row.hold_state, [
            "HELD",
            "AWAITING_REPLACEMENT",
            "FORFEITURE_DUE",
            "RELEASED",
            "REFUNDED",
            "FORFEITED",
          ]),
          createdAt: date(row.hold_created_at),
          settledAt: optionalDate(row.settled_at),
        });
  if (hold !== undefined && hold.walletId !== walletId)
    throw new SessionPersistenceError(
      "Participation hold belongs to another wallet",
    );
  return new Participation({
    participationId: text(row.participation_id),
    userId: text(row.user_id),
    status: choice(row.status, [
      "WAITLISTED",
      "COMMITTED",
      "LEFT_WAITLIST",
      "WITHDRAWN",
      "REMOVED",
      "CANCELLED",
    ]),
    attendance: choice(row.attendance, ["UNVERIFIED", "ATTENDED", "ABSENT"]),
    waitlistedAt: optionalDate(row.waitlisted_at),
    committedAt: optionalDate(row.committed_at),
    withdrawnAt: optionalDate(row.withdrawn_at),
    replacementMode:
      row.replacement_mode === null
        ? undefined
        : choice(row.replacement_mode, ["OPEN_SLOT", "DIRECT_INVITE"]),
    replacementInviteeId: optionalText(row.replacement_invitee_id),
    verifiedAt: optionalDate(row.verified_at),
    verificationMethod:
      row.verification_method === null
        ? undefined
        : choice(row.verification_method, ["BOOKER", "AUTOMATIC"]),
    replacesParticipationId: optionalText(row.replaces_participation_id),
    queueSequence: optionalInteger(row.queue_sequence),
    hold,
  });
}
