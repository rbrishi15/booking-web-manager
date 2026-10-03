import type { Participation, Session, UUID } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { SessionPersistenceError } from "./postgres-row-values";
import { PostgresSessionManagementRepository } from "./postgres-session-management-repository";

/** Writes only the cancellation transitions of a session loaded by this transaction. */
export class PostgresSessionCancellationRepository {
  private readonly originals = new Map<UUID, readonly Participation[]>();
  constructor(private readonly sql: SqlExecutor) {}

  async get(id: UUID): Promise<Session | null> {
    const session = await new PostgresSessionManagementRepository(this.sql).get(id);
    if (session) {
      // Terminal history emits no new instruction, so insertion-time ledger
      // checks alone cannot detect missing refunds or mismatched hold ownership.
      const inconsistent = await this.sql.query(
        `select coalesce(h.hold_id, b.hold_id) as hold_id
         from fund_holds h join participations p on p.participation_id = h.participation_id
         full join hold_balances b on b.hold_id = h.hold_id
         where (p.session_id = $1 or b.session_id = $1) and (
           h.hold_id is null or b.hold_id is null
           or b.session_id is distinct from p.session_id
           or b.participation_id is distinct from h.participation_id
           or b.wallet_id is distinct from h.wallet_id
           or b.holding_account_id is distinct from h.holding_account_id
           or b.original_cents <> h.amount_cents
           or b.held_cents <> case when h.state in ('HELD', 'AWAITING_REPLACEMENT', 'FORFEITURE_DUE') then h.amount_cents else 0 end
           or b.settled_kind::text is distinct from case h.state
             when 'REFUNDED' then 'REFUND' when 'RELEASED' then 'RELEASE' when 'FORFEITED' then 'FORFEIT' else null end
         )`,
        [id],
      );
      if (inconsistent.length !== 0) throw new SessionPersistenceError("Stored holds disagree with the ledger projection");
      this.originals.set(id, session.participantList.participations);
    }
    return session;
  }

  async saveCancellation(session: Session): Promise<void> {
    const original = this.originals.get(session.sessionId);
    if (!original || session.status !== "CANCELLED")
      throw new SessionPersistenceError("Cancellation requires a loaded cancelled session");
    for (const before of original) {
      const after = session.participantList.requireParticipation(before.participationId);
      if (after === before) continue;
      const rows = await this.sql.query(
        `update participations set status = $3, replacement_mode = $4, replacement_invitee_id = $5
         where session_id = $1 and participation_id = $2 returning participation_id`,
        [session.sessionId, after.participationId, after.status, after.replacementMode ?? null, after.replacementInviteeId ?? null],
      );
      if (rows.length !== 1) throw new SessionPersistenceError("Cancellation participation was not found");
      if (after.hold && after.hold !== before.hold) {
        const holds = await this.sql.query(
          "update fund_holds set state = $3, settled_at = $4 where hold_id = $1 and participation_id = $2 returning hold_id",
          [after.hold.holdId, after.participationId, after.hold.state, after.hold.settledAt],
        );
        if (holds.length !== 1) throw new SessionPersistenceError("Cancellation hold was not found");
      }
    }
    const rows = await this.sql.query(
      "update sessions set status = 'CANCELLED' where session_id = $1 and status = 'OPEN' returning session_id",
      [session.sessionId],
    );
    if (rows.length !== 1) throw new SessionPersistenceError("Cancellation session was not open");
  }
}
