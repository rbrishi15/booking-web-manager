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

/** Must run within the creation transaction's repeatable-read snapshot. */
export class PostgresUserReader {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly clock: Clock,
  ) {}

  async get(userId: UUID): Promise<User | null> {
    // SHARE (not KEY SHARE) blocks changes to account/email eligibility until
    // commit. Payout is locked separately because an outer join's nullable side
    // cannot be row-locked. Missing payout setup remains an ordinary domain case.
    const profiles = await this.sql.query(
      `select p.user_id, p.account_status, p.preferred_sports, p.preferred_regions, u.email
         from profiles p join auth.users u on u.id = p.user_id
        where p.user_id = $1
        for share of p, u`,
      [userId],
    );
    const profile = profiles[0];
    if (profile === undefined) return null;

    const payouts = await this.sql.query(
      `select payout_account_id, user_id, provider_account_reference,
              bank_account_reference, setup_status
         from payout_accounts where user_id = $1 for share`,
      [userId],
    );
    const wallets = await this.sql.query(
      "select wallet_id, user_id from wallets where user_id = $1",
      [userId],
    );
    const walletRow = wallets[0];
    if (walletRow === undefined) {
      throw new SessionPersistenceError("Stored user has no wallet");
    }
    const walletId = text(walletRow.wallet_id, "wallet_id");
    // Deliberately unpaginated: the UI ledger reader caps pages at 200, which
    // would silently hydrate an incorrect Wallet balance here.
    const transactions = await this.sql.query(
      `select entry_id, amount_cents, kind, occurred_at, idempotency_key,
              external_reference, wallet_id, hold_id, payout_id
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

    // Only conversion/constructor failures are wrapped. Query failures retain
    // their SQLSTATE translation so serialization/deadlock retries still work.
    try {
      const accountStatus = choice(profile.account_status, "account_status", [
        "ACTIVE",
        "INACTIVE",
      ]);
      const payout = payouts[0];
      return new User({
        userId: text(profile.user_id, "user_id"),
        // Auth retains the authentication record; the inactive domain profile
        // must not expose that email as an active account identity.
        email:
          accountStatus === "INACTIVE"
            ? null
            : new Email(text(profile.email, "email")),
        accountStatus,
        preferredSports: new Set(
          strings(profile.preferred_sports, "preferred_sports"),
        ),
        preferredRegions: new Set(
          strings(profile.preferred_regions, "preferred_regions"),
        ),
        payoutAccount: payout === undefined ? undefined : payoutAccount(payout),
        wallet: new Wallet({
          walletId,
          userId: text(walletRow.user_id, "wallet.user_id"),
          transactions: transactions.map(ledgerTransaction),
        }),
        memberGroupIds: memberships.map((row) =>
          text(row.group_id, "group_id"),
        ),
        reliabilityScore: ReliabilityScore.fromHistory(
          userId,
          history.map((row) => ({
            participation: participation(row, walletId),
            endAt: date(row.end_at, "end_at"),
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

function payoutAccount(row: SqlRow): PayoutAccount {
  return new PayoutAccount({
    payoutAccountId: text(row.payout_account_id, "payout_account_id"),
    userId: text(row.user_id, "payout.user_id"),
    providerAccountReference: text(
      row.provider_account_reference,
      "provider_account_reference",
    ),
    bankAccountReference: optionalText(
      row.bank_account_reference,
      "bank_account_reference",
    ),
    setupStatus: choice(row.setup_status, "setup_status", [
      "PENDING",
      "COMPLETE",
      "FAILED",
    ]),
  });
}

function ledgerTransaction(row: SqlRow): LedgerTransaction {
  return new LedgerTransaction({
    transactionId: text(row.entry_id, "entry_id"),
    amount: fromDatabaseCents(row.amount_cents, "amount_cents"),
    kind: choice(row.kind, "kind", [
      "TOP_UP",
      "LOCK",
      "RELEASE",
      "REFUND",
      "FORFEIT",
      "PAYOUT",
    ]),
    occurredAt: date(row.occurred_at, "occurred_at"),
    idempotencyKey: text(row.idempotency_key, "idempotency_key"),
    externalReference: optionalText(
      row.external_reference,
      "external_reference",
    ),
    walletId: optionalText(row.wallet_id, "wallet_id"),
    holdId: optionalText(row.hold_id, "hold_id"),
    payoutId: optionalText(row.payout_id, "payout_id"),
  });
}

function participation(row: SqlRow, walletId: UUID): Participation {
  const hold =
    row.hold_id === null
      ? undefined
      : new FundHold({
          holdId: text(row.hold_id, "hold_id"),
          participationId: text(
            row.hold_participation_id,
            "hold_participation_id",
          ),
          holdingAccountId: text(row.holding_account_id, "holding_account_id"),
          walletId: text(row.wallet_id, "hold.wallet_id"),
          payoutId: optionalText(row.payout_id, "payout_id"),
          amount: fromDatabaseCents(row.amount_cents, "amount_cents"),
          state: choice(row.hold_state, "hold_state", [
            "HELD",
            "AWAITING_REPLACEMENT",
            "FORFEITURE_DUE",
            "RELEASED",
            "REFUNDED",
            "FORFEITED",
          ]),
          createdAt: date(row.hold_created_at, "hold_created_at"),
          settledAt: optionalDate(row.settled_at, "settled_at"),
        });
  if (hold !== undefined && hold.walletId !== walletId) {
    throw new SessionPersistenceError(
      "Participation hold belongs to another wallet",
    );
  }
  return new Participation({
    participationId: text(row.participation_id, "participation_id"),
    userId: text(row.user_id, "participation.user_id"),
    status: choice(row.status, "participation.status", [
      "WAITLISTED",
      "COMMITTED",
      "LEFT_WAITLIST",
      "WITHDRAWN",
      "REMOVED",
      "CANCELLED",
    ]),
    attendance: choice(row.attendance, "attendance", [
      "UNVERIFIED",
      "ATTENDED",
      "ABSENT",
    ]),
    waitlistedAt: optionalDate(row.waitlisted_at, "waitlisted_at"),
    committedAt: optionalDate(row.committed_at, "committed_at"),
    withdrawnAt: optionalDate(row.withdrawn_at, "withdrawn_at"),
    replacementMode:
      row.replacement_mode === null
        ? undefined
        : choice(row.replacement_mode, "replacement_mode", [
            "OPEN_SLOT",
            "DIRECT_INVITE",
          ]),
    replacementInviteeId: optionalText(
      row.replacement_invitee_id,
      "replacement_invitee_id",
    ),
    verifiedAt: optionalDate(row.verified_at, "verified_at"),
    verificationMethod:
      row.verification_method === null
        ? undefined
        : choice(row.verification_method, "verification_method", [
            "BOOKER",
            "AUTOMATIC",
          ]),
    replacesParticipationId: optionalText(
      row.replaces_participation_id,
      "replaces_participation_id",
    ),
    queueSequence: optionalInteger(row.queue_sequence, "queue_sequence"),
    hold,
  });
}
