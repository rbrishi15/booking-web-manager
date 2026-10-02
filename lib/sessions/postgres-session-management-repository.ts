import { z } from "zod";
import { Booking, Money, ReliabilityScore, Session, type PayoutBatch, type UUID } from "@/domain";
import { fromDatabaseCents } from "@/lib/money/cents";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";
import { hydrateParticipation } from "./postgres-participation-reader";
import { choice, date, optionalText, SessionPersistenceError, strings, text } from "./postgres-row-values";

const sessionColumns = `session_id, booker_id, venue_name, region, sport, start_at, end_at,
  total_cost_cents, total_slots, minimum_headcount, booking_share_cents, visibility, status,
  minimum_reliability, room_token, holding_account_id, invited_group_id, next_queue_sequence,
  payout_attempt_ids, payout_idempotency_keys, pending_settlement`;

const storedBatch = z.object({
  payoutId: z.string().min(1),
  sessionId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  requestedAt: z.string().datetime({ offset: true }),
  destination: z.object({
    payoutAccountId: z.string().min(1), userId: z.string().min(1),
    providerAccountReference: z.string().min(1), bankAccountReference: z.string().min(1),
  }),
  lines: z.array(z.object({
    holdId: z.string().min(1), participationId: z.string().min(1),
    holdingAccountId: z.string().min(1), walletId: z.string().min(1),
    amountCents: z.number().int().safe().positive(), kind: z.enum(["RELEASE", "FORFEIT"]),
  })),
});

/** Complete aggregate reads and a deliberately visibility-only persistence command. */
export class PostgresSessionManagementRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async get(sessionId: UUID): Promise<Session | null> {
    const rows = await this.sql.query(
      `select ${sessionColumns} from sessions where session_id = $1 for update`,
      [sessionId],
    );
    return (await this.hydrate(rows))[0] ?? null;
  }

  async listUpcoming(bookerId: UUID, now: Date): Promise<readonly Session[]> {
    const rows = await this.sql.query(
      `select ${sessionColumns} from sessions
       where booker_id = $1 and status = 'OPEN' and start_at > $2
       order by start_at, session_id`,
      [bookerId, now],
    );
    return this.hydrate(rows);
  }

  async saveVisibility(session: Session): Promise<void> {
    const rows = await this.sql.query(
      "update sessions set visibility = $2 where session_id = $1 returning session_id",
      [session.sessionId, session.visibility],
    );
    if (rows.length !== 1)
      throw new SessionPersistenceError("Visibility update did not find exactly one session");
  }

  private async hydrate(rows: readonly SqlRow[]): Promise<readonly Session[]> {
    if (rows.length === 0) return [];
    // SQL errors must retain their translated SQLSTATE so the transaction can retry.
    const participants = await this.sql.query(
      `select p.*, w.wallet_id as participant_wallet_id,
              h.hold_id, h.participation_id as hold_participation_id,
              h.holding_account_id, h.wallet_id, h.payout_id, h.amount_cents,
              h.state as hold_state, h.created_at as hold_created_at, h.settled_at
       from participations p
       left join wallets w on w.user_id = p.user_id
       left join fund_holds h on h.participation_id = p.participation_id
       where p.session_id = any($1::uuid[]) order by p.session_id, p.list_position`,
      [rows.map((row) => row.session_id)],
    );
    try {
      return rows.map((row) => {
        const sessionId = text(row.session_id);
        const session = new Session({
          sessionId,
          bookerId: text(row.booker_id),
          booking: new Booking({
            venueName: text(row.venue_name), region: text(row.region), sport: text(row.sport),
            startAt: date(row.start_at), endAt: date(row.end_at),
            totalCost: fromDatabaseCents(row.total_cost_cents, "total_cost_cents"),
          }),
          totalSlots: z.number().int().safe().parse(row.total_slots),
          bookingShare: fromDatabaseCents(row.booking_share_cents, "booking_share_cents"),
          minimumHeadcount: z.number().int().safe().parse(row.minimum_headcount),
          visibility: choice(row.visibility, ["PUBLIC", "PRIVATE"]),
          status: choice(row.status, ["OPEN", "CANCELLED", "AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"]),
          minimumReliability: row.minimum_reliability === null
            ? undefined : ReliabilityScore.from(z.coerce.number().finite().parse(row.minimum_reliability)),
          roomToken: text(row.room_token), holdingAccountId: text(row.holding_account_id),
          invitedGroupId: optionalText(row.invited_group_id),
          participations: participants.filter((participation) => participation.session_id === sessionId)
            .map((participation) => hydrateParticipation(participation, text(participation.participant_wallet_id))),
          nextQueueSequence: z.number().int().safe().parse(row.next_queue_sequence),
          payoutAttemptIds: strings(row.payout_attempt_ids),
          payoutIdempotencyKeys: strings(row.payout_idempotency_keys),
          pendingSettlement: hydrateBatch(row.pending_settlement),
        });
        return session;
      });
    } catch (cause) {
      throw new SessionPersistenceError("Stored session state could not be hydrated", { cause });
    }
  }
}

function hydrateBatch(value: unknown): PayoutBatch | undefined {
  if (value === null) return undefined;
  const parsed = storedBatch.parse(value);
  return {
    ...parsed,
    requestedAt: new Date(parsed.requestedAt),
    lines: parsed.lines.map(({ amountCents, ...line }) => ({ ...line, amount: Money.fromCents(amountCents) })),
  };
}
