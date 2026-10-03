import { randomUUID } from "node:crypto";
import { PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money/constants";
import type { SqlExecutor } from "@/lib/money/sql";
import type { SessionTestContext } from "./session-test-context";

export type CancellationIdentity = Awaited<ReturnType<SessionTestContext["identity"]>>;

/** Seeds real held ledger funds on the disposable stack, without a commitment endpoint. */
export async function addCancellationParticipant(sql: SqlExecutor, sessionId: string, participant: CancellationIdentity) {
  const participationId = randomUUID();
  const holdId = randomUUID();
  await sql.query(
    "insert into participations(participation_id,session_id,user_id,status,attendance,committed_at) values ($1,$2,$3,'COMMITTED','UNVERIFIED',now())",
    [participationId, sessionId, participant.userId],
  );
  await sql.query(
    "insert into fund_holds(hold_id,participation_id,holding_account_id,wallet_id,amount_cents,state,created_at) values ($1,$2,$3,$4,500,'HELD',now())",
    [holdId, participationId, PLATFORM_HOLDING_ACCOUNT_ID, participant.walletId],
  );
  await sql.query(
    "insert into ledger_entries(kind,amount_cents,occurred_at,idempotency_key,external_reference,wallet_id) values ('TOP_UP',500,now(),$1,$2,$3)",
    [randomUUID(), randomUUID(), participant.walletId],
  );
  await sql.query(
    "insert into ledger_entries(kind,amount_cents,occurred_at,idempotency_key,wallet_id,hold_id,holding_account_id,session_id,participation_id) values ('LOCK',500,now(),$1,$2,$3,$4,$5,$6)",
    [randomUUID(), participant.walletId, holdId, PLATFORM_HOLDING_ACCOUNT_ID, sessionId, participationId],
  );
  return { ...participant, participationId, holdId };
}

export function cancellationSql(context: SessionTestContext): SqlExecutor {
  return { query: async (statement, values) => (await context.pool.query(statement, values ? [...values] : undefined)).rows };
}

export async function cancellationFixture(context: SessionTestContext, participantCount = 1) {
  const booker = await context.identity(false);
  const sessionId = randomUUID();
  const venueName = `Cancel-${randomUUID().slice(0, 8)}`;
  await context.pool.query(
    `insert into sessions(session_id,booker_id,venue_name,region,sport,start_at,end_at,total_cost_cents,
      total_slots,booking_share_cents,visibility,room_token,holding_account_id)
      values ($1,$2,$3,'West','Badminton','2045-04-02T10:00:00Z','2045-04-02T12:00:00Z',
      1000,2,500,'PUBLIC',$4,$5)`,
    [sessionId, booker.userId, venueName, randomUUID(), PLATFORM_HOLDING_ACCOUNT_ID],
  );
  const participants = [];
  for (let index = 0; index < participantCount; index++)
    participants.push(await addCancellationParticipant(cancellationSql(context), sessionId, await context.identity(false)));
  return { booker, sessionId, venueName, participants };
}
