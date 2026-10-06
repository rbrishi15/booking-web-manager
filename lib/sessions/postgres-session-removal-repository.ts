import type { Participation, Session, UUID } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { SessionPersistenceError } from "./postgres-row-values";
import { PostgresSessionManagementRepository } from "./postgres-session-management-repository";

/** Loads the complete aggregate but persists only its selected removal transition. */
export class PostgresSessionRemovalRepository {
  private readonly originals = new Map<UUID, readonly Participation[]>();
  constructor(private readonly sql: SqlExecutor) {}

  async get(id: UUID): Promise<Session | null> {
    const session = await new PostgresSessionManagementRepository(this.sql).get(id);
    if (session) {
      // Reconcile terminal history too: a prior refund cannot disappear or be credited twice.
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

  async saveRemoval(session: Session, participationId: UUID): Promise<void> {
    const original = this.originals.get(session.sessionId);
    const before = original?.find((participation) => participation.participationId === participationId);
    const after = session.participantList.participations.find((participation) => participation.participationId === participationId);
    if (!original || !before || !after || session.status !== "OPEN"
      || before.status !== "COMMITTED" || after.status !== "REMOVED"
      || !before.hold || !after.hold || before.hold.state !== "HELD" || after.hold.state !== "REFUNDED"
      || before.hold.holdId !== after.hold.holdId
      || original.length !== session.participantList.participations.length
      || original.some((participation, index) => participation !== before
        && session.participantList.participations[index] !== participation)) {
      throw new SessionPersistenceError("Removal requires exactly one loaded committed participant transition");
    }
    const rows = await this.sql.query(
      `update participations set status = 'REMOVED'
       where session_id = $1 and participation_id = $2 and status = 'COMMITTED' returning participation_id`,
      [session.sessionId, participationId],
    );
    if (rows.length !== 1) throw new SessionPersistenceError("Removal participation was not committed");
    const holds = await this.sql.query(
      `update fund_holds set state = 'REFUNDED', settled_at = $3
       where hold_id = $1 and participation_id = $2 and state = 'HELD' returning hold_id`,
      [after.hold.holdId, participationId, after.hold.settledAt],
    );
    if (holds.length !== 1) throw new SessionPersistenceError("Removal hold was not held");
  }
}
