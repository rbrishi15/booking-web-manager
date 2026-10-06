import {
  Email,
  LedgerTransaction,
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
  optionalText,
  optionalDate,
  SessionPersistenceError,
  strings,
  text,
} from "./postgres-row-values";
import { hydrateParticipation } from "./postgres-participation-reader";

export class PostgresUserReader {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly clock: Clock,
  ) {}

  async get(userId: UUID): Promise<User | null> {
    const profiles = await this.sql.query(
      `select p.user_id, p.account_status, p.preferred_sports, p.preferred_regions,
              u.email, u.email_confirmed_at
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
      const email = status === "INACTIVE" || profile.email === null || profile.email === ""
        ? null : new Email(text(profile.email));
      return new User({
        userId: text(profile.user_id),
        accountStatus: status,
        email,
        emailVerified: email !== null && optionalDate(profile.email_confirmed_at) !== undefined,
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
