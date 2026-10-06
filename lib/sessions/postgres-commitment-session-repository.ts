import type { FundHold, Participation, Session, UUID } from "@/domain";
import { toDatabaseCents } from "@/lib/money/cents";
import type { SqlExecutor } from "@/lib/money/sql";
import { SessionPersistenceError } from "./postgres-row-values";
import { PostgresSessionManagementRepository } from "./postgres-session-management-repository";

interface LoadedSession {
  readonly participations: ReadonlyMap<UUID, Participation>;
  readonly visibility: Session["visibility"];
  readonly payoutAttemptIds: readonly UUID[];
}

/**
 * Session persistence for the commitment workflows (UC2-04, UC2-05, UC2-06):
 * joining and the waitlist, promotion, withdrawal, replacement, replacement
 * expiry and attendance.
 *
 * `get` locks the session row (`FOR UPDATE`) and hydrates the complete
 * aggregate through the shared session reader, so concurrent commitments to
 * one session serialize. `save` writes only what changed since that load:
 * new participations and holds are inserted in roster order, changed ones are
 * updated, and the session's status and queue sequence are stored. Domain
 * children are immutable, so an unchanged participation is the same object.
 *
 * Visibility and payout state belong to other workflows; a save that changes
 * them is rejected rather than silently written or dropped.
 */
export class PostgresCommitmentSessionRepository {
  private readonly loaded = new Map<UUID, LoadedSession>();

  /** Uses the caller's SQL executor so reads and writes share its transaction. */
  constructor(private readonly sql: SqlExecutor) {}

  async get(sessionId: UUID): Promise<Session | null> {
    const session = await new PostgresSessionManagementRepository(this.sql).get(
      sessionId,
    );
    if (session) {
      this.loaded.set(sessionId, {
        participations: new Map(
          session.participantList.participations.map((participation) => [
            participation.participationId,
            participation,
          ]),
        ),
        visibility: session.visibility,
        payoutAttemptIds: session.payoutAttemptIds,
      });
    }
    return session;
  }

  async save(session: Session): Promise<void> {
    const loaded = this.loaded.get(session.sessionId);
    if (!loaded)
      throw new SessionPersistenceError(
        "A session must be loaded in this transaction before it is saved",
      );
    if (
      session.visibility !== loaded.visibility ||
      session.payoutAttemptIds.length !== loaded.payoutAttemptIds.length
    )
      throw new SessionPersistenceError(
        "Commitment workflows cannot persist visibility or payout changes",
      );

    const current = session.participantList.participations;
    const currentIds = new Set(current.map((p) => p.participationId));
    for (const id of loaded.participations.keys())
      if (!currentIds.has(id))
        throw new SessionPersistenceError(
          "A participation disappeared from the session",
        );

    // Roster order: inserts take the next list_position, preserving order.
    for (const after of current) {
      const before = loaded.participations.get(after.participationId);
      if (before === undefined) {
        await this.insertParticipation(session.sessionId, after);
        if (after.hold) await this.insertHold(after.hold);
        continue;
      }
      if (after === before) continue;
      await this.updateParticipation(session.sessionId, after);
      if (after.hold && !before.hold) await this.insertHold(after.hold);
      else if (after.hold && before.hold && after.hold !== before.hold)
        await this.updateHold(after.hold);
      else if (!after.hold && before.hold)
        throw new SessionPersistenceError("A fund hold cannot be removed");
    }

    const rows = await this.sql.query(
      `update sessions set status = $2, next_queue_sequence = $3
       where session_id = $1 returning session_id`,
      [
        session.sessionId,
        session.status,
        session.participantList.nextQueueSequence,
      ],
    );
    if (rows.length !== 1)
      throw new SessionPersistenceError("Session update did not find the session");

    this.loaded.set(session.sessionId, {
      participations: new Map(current.map((p) => [p.participationId, p])),
      visibility: session.visibility,
      payoutAttemptIds: session.payoutAttemptIds,
    });
  }

  private async insertParticipation(
    sessionId: UUID,
    p: Participation,
  ): Promise<void> {
    await this.sql.query(
      `insert into participations (participation_id, session_id, user_id, status,
         attendance, waitlisted_at, committed_at, withdrawn_at, replacement_mode,
         replacement_invitee_id, verified_at, verification_method,
         replaces_participation_id, queue_sequence)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [p.participationId, sessionId, p.userId, ...participationValues(p)],
    );
  }

  private async updateParticipation(
    sessionId: UUID,
    p: Participation,
  ): Promise<void> {
    const rows = await this.sql.query(
      `update participations set status = $4, attendance = $5,
         waitlisted_at = $6, committed_at = $7, withdrawn_at = $8,
         replacement_mode = $9, replacement_invitee_id = $10, verified_at = $11,
         verification_method = $12, replaces_participation_id = $13,
         queue_sequence = $14
       where session_id = $1 and participation_id = $2 and user_id = $3
       returning participation_id`,
      [sessionId, p.participationId, p.userId, ...participationValues(p)],
    );
    if (rows.length !== 1)
      throw new SessionPersistenceError("Participation update did not find its row");
  }

  private async insertHold(hold: FundHold): Promise<void> {
    await this.sql.query(
      `insert into fund_holds (hold_id, participation_id, holding_account_id,
         wallet_id, payout_id, amount_cents, state, created_at, settled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        hold.holdId,
        hold.participationId,
        hold.holdingAccountId,
        hold.walletId,
        hold.payoutId ?? null,
        toDatabaseCents(hold.amount),
        hold.state,
        hold.createdAt,
        hold.settledAt ?? null,
      ],
    );
  }

  private async updateHold(hold: FundHold): Promise<void> {
    const rows = await this.sql.query(
      `update fund_holds set state = $3, settled_at = $4, payout_id = $5
       where hold_id = $1 and participation_id = $2 returning hold_id`,
      [
        hold.holdId,
        hold.participationId,
        hold.state,
        hold.settledAt ?? null,
        hold.payoutId ?? null,
      ],
    );
    if (rows.length !== 1)
      throw new SessionPersistenceError("Fund hold update did not find its row");
  }
}

/** Mutable participation columns, in the order both statements use ($4–$14). */
function participationValues(p: Participation): unknown[] {
  return [
    p.status,
    p.attendance,
    p.waitlistedAt ?? null,
    p.committedAt ?? null,
    p.withdrawnAt ?? null,
    p.replacementMode ?? null,
    p.replacementInviteeId ?? null,
    p.verifiedAt ?? null,
    p.verificationMethod ?? null,
    p.replacesParticipationId ?? null,
    p.queueSequence ?? null,
  ];
}
