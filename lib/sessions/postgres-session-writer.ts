import type { Session, UUID } from "@/domain";
import { toDatabaseCents } from "@/lib/money/cents";
import type { SqlExecutor } from "@/lib/money/sql";
import { SessionPersistenceError } from "./postgres-row-values";

/** Only creation inserts are supported; lifecycle updates belong to their own adapters. */
export class PostgresSessionWriter {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly bookerId: UUID,
  ) {}

  async save(session: Session): Promise<void> {
    if (
      session.bookerId !== this.bookerId ||
      session.status !== "OPEN" ||
      session.participantList.participations.length !== 0 ||
      session.participantList.nextQueueSequence !== 1 ||
      session.pendingSettlement !== undefined ||
      session.payoutAttemptIds.length !== 0 ||
      session.payoutIdempotencyKeys.length !== 0
    ) {
      throw new SessionPersistenceError(
        "Creation can only insert a new session for its booker",
      );
    }
    const booking = session.booking;
    await this.sql.query(
      `insert into sessions (session_id, booker_id, venue_name, region, sport, start_at, end_at,
        total_cost_cents, total_slots, booking_share_cents, visibility, status,
        minimum_reliability, room_token, holding_account_id, invited_group_id, next_queue_sequence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        session.sessionId,
        session.bookerId,
        booking.venueName,
        booking.region,
        booking.sport,
        booking.startAt,
        booking.endAt,
        toDatabaseCents(booking.totalCost),
        session.totalSlots,
        toDatabaseCents(session.bookingShare),
        session.visibility,
        session.status,
        session.minimumReliability?.toNumber() ?? null,
        session.roomToken,
        session.holdingAccountId,
        session.invitedGroupId ?? null,
        session.participantList.nextQueueSequence,
      ],
    );
  }
}
