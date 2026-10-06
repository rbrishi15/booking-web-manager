import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ParticipantRemovalVersioner } from "@/lib/sessions/removal-versioner";
import { PostgresSessionRemovalReadTransaction } from "@/lib/sessions/postgres-session-removal-read-transaction";
import { PostgresSessionRemovalTransaction } from "@/lib/sessions/postgres-session-removal-transaction";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { PostgresSessionCancellationTransaction } from "@/lib/sessions/postgres-session-cancellation-transaction";
import { SessionCancellationVersioner } from "@/lib/sessions/cancellation-versioner";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { SessionPersistenceError } from "@/lib/sessions/postgres-row-values";
import { ListSessionParticipants } from "@/use-cases/sessions/ListSessionParticipants";
import { PreviewParticipantRemoval } from "@/use-cases/sessions/PreviewParticipantRemoval";
import { RemoveParticipant } from "@/use-cases/sessions/RemoveParticipant";
import { CancelSession } from "@/use-cases/sessions/CancelSession";
import { PreviewSessionCancellation } from "@/use-cases/sessions/PreviewSessionCancellation";
import type { SessionRemovalTransaction } from "@/use-cases/sessions/session-removal-transaction";
import { cancellationFixture, addCancellationParticipant } from "../support/cancellation-fixtures";
import { sessionTestContext, sessionTestEnvironment, type SessionTestContext } from "../support/session-test-context";

const clock = { now: () => new Date("2045-04-01T12:00:00Z") };
const versioner = new ParticipantRemovalVersioner();

describe("UC2-03b PostgreSQL participant removal", () => {
  let context: SessionTestContext;
  beforeAll(() => { context = sessionTestContext(); });
  afterAll(async () => { await context?.pool.end(); });
  function reads() { return new PostgresSessionRemovalReadTransaction(() => context.pool, clock); }
  function transaction(key = randomUUID()) { return new PostgresSessionRemovalTransaction(() => context.pool, clock, key); }
  function preview() { return new PreviewParticipantRemoval({ transaction: reads(), clock, versioner }); }
  function remove(tx: SessionRemovalTransaction = transaction()) { return new RemoveParticipant({ transaction: tx, clock, versioner }); }
  function list() { return new ListSessionParticipants({ transaction: reads(), clock }); }
  async function refunds(sessionId: string) {
    return (await context.pool.query("select amount_cents,participation_id from ledger_entries where session_id=$1 and kind='REFUND'", [sessionId])).rows;
  }

  test("owner list and read-only preview precede one full historical refund inside 30 hours", async () => {
    const f = await cancellationFixture(context, 2);
    const [target, other] = f.participants;
    await context.pool.query("update profiles set display_name=$2 where user_id=$1", [target!.userId, "First player"]);
    await context.pool.query("update profiles set display_name=$2 where user_id=$1", [other!.userId, "Second player"]);
    const sessionBefore = (await context.pool.query("select * from sessions where session_id=$1", [f.sessionId])).rows[0];
    const childrenBefore = (await context.pool.query("select * from participations where session_id=$1 order by list_position", [f.sessionId])).rows;
    const items = await list().forBooker(f.booker.userId, f.sessionId);
    expect(items.availableSlots).toBe(0);
    expect(items.participants.map((p) => p.displayName)).toEqual(["First player", "Second player"]);
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target!.participationId);
    expect(quote.refundCents).toBe(500);
    expect(await refunds(f.sessionId)).toEqual([]);
    expect((await context.pool.query("select * from participations where session_id=$1 order by list_position", [f.sessionId])).rows).toEqual(childrenBefore);
    const result = await remove().forBooker(f.booker.userId, f.sessionId, target!.participationId, quote.previewVersion);
    expect(result).toEqual({ sessionId: f.sessionId, participationId: target!.participationId, status: "REMOVED", refundCents: 500 });
    expect((await context.pool.query("select * from sessions where session_id=$1", [f.sessionId])).rows[0]).toEqual(sessionBefore);
    expect((await context.pool.query("select * from participations where session_id=$1 order by list_position", [f.sessionId])).rows)
      .toEqual([{ ...childrenBefore[0], status: "REMOVED" }, childrenBefore[1]]);
    expect((await context.pool.query("select available_cents from wallet_balances where wallet_id=$1", [target!.walletId])).rows[0].available_cents).toBe("500");
    expect((await context.pool.query("select state,settled_at from fund_holds where hold_id=$1", [target!.holdId])).rows[0]).toEqual({ state: "REFUNDED", settled_at: clock.now() });
    expect((await context.pool.query("select held_cents,settled_kind from hold_balances where hold_id=$1", [target!.holdId])).rows[0]).toEqual({ held_cents: "0", settled_kind: "REFUND" });
    const refreshed = await list().forBooker(f.booker.userId, f.sessionId);
    expect(refreshed.availableSlots).toBe(1);
    expect(refreshed.participants[0]).toMatchObject({ status: "REMOVED", canRemove: false });
    expect(refreshed.participants[1]).toMatchObject({ status: "COMMITTED", canRemove: true });
  });

  test("same-key concurrent retries replay once, bind the target, and recheck current account access", async () => {
    const f = await cancellationFixture(context, 2);
    const target = f.participants[0]!;
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    const key = randomUUID();
    const submit = () => remove(transaction(key)).forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion);
    const results = await Promise.all([submit(), submit()]);
    expect(results[0]).toEqual(results[1]);
    expect(await refunds(f.sessionId)).toHaveLength(1);
    await expect(remove(transaction(key)).forBooker(f.booker.userId, f.sessionId, f.participants[1]!.participationId, quote.previewVersion))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await context.pool.query("update profiles set account_status='INACTIVE' where user_id=$1", [f.booker.userId]);
    await expect(submit()).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(await refunds(f.sessionId)).toHaveLength(1);
  });

  test("different-key double removal produces one result and one conflict", async () => {
    const f = await cancellationFixture(context);
    const target = f.participants[0]!;
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    const results = await Promise.allSettled([remove(), remove()].map((action) => action.forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await refunds(f.sessionId)).toHaveLength(1);
  });

  test.each(["ledger", "children", "response"] as const)("rolls back %s-stage failure including the replay claim", async (stage) => {
    const f = await cancellationFixture(context);
    const target = f.participants[0]!;
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    const key = randomUUID();
    const actual = transaction(key);
    const failure = new Error("Injected removal failure");
    const failing: SessionRemovalTransaction = { run: (work) => actual.run(async (repositories) => {
      const result = await work({ ...repositories,
        ledger: { append: async (instructions) => { await repositories.ledger.append(instructions); if (stage === "ledger") throw failure; } },
        sessions: { get: (id) => repositories.sessions.get(id), saveRemoval: async (session, participationId) => {
          await repositories.sessions.saveRemoval(session, participationId);
          if (stage === "children") throw failure;
        } },
      });
      if (stage === "response") throw failure;
      return result;
    }) };
    await expect(remove(failing).forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion)).rejects.toBe(failure);
    expect(await refunds(f.sessionId)).toEqual([]);
    expect((await context.pool.query("select status from participations where participation_id=$1", [target.participationId])).rows[0].status).toBe("COMMITTED");
    expect((await context.pool.query("select state from fund_holds where hold_id=$1", [target.holdId])).rows[0].state).toBe("HELD");
    expect((await context.pool.query("select count(*)::int as count from idempotency_keys where idempotency_key=$1", [JSON.stringify(["UC2-03b", f.booker.userId, key])])).rows[0].count).toBe(0);
  });

  test("removal followed by cancellation preserves history and refunds each hold once", async () => {
    const f = await cancellationFixture(context, 2);
    const target = f.participants[0]!;
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    const action = remove();
    const result = await action.forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion);
    const cancelVersioner = new SessionCancellationVersioner();
    const cancellationPreview = await new PreviewSessionCancellation({ transaction: new PostgresSessionManagementTransaction(() => context.pool, clock), clock, versioner: cancelVersioner }).forBooker(f.booker.userId, f.sessionId);
    expect(cancellationPreview.totalRefundCents).toBe(500);
    await new CancelSession({ transaction: new PostgresSessionCancellationTransaction(() => context.pool, clock, randomUUID()), clock, versioner: cancelVersioner }).forBooker(f.booker.userId, f.sessionId, cancellationPreview.previewVersion);
    expect(await action.forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion)).toEqual(result);
    expect((await context.pool.query("select status from participations where participation_id=$1", [target.participationId])).rows[0].status).toBe("REMOVED");
    expect(await refunds(f.sessionId)).toHaveLength(2);
  });

  test("racing cancellation and removal have a valid serial outcome without duplicate refunds", async () => {
    const f = await cancellationFixture(context, 2);
    const target = f.participants[0]!;
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    const cancelVersioner = new SessionCancellationVersioner();
    const cancellationPreview = await new PreviewSessionCancellation({ transaction: new PostgresSessionManagementTransaction(() => context.pool, clock), clock, versioner: cancelVersioner }).forBooker(f.booker.userId, f.sessionId);
    const cancellation = new CancelSession({ transaction: new PostgresSessionCancellationTransaction(() => context.pool, clock, randomUUID()), clock, versioner: cancelVersioner });
    const results = await Promise.allSettled([
      remove().forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion),
      cancellation.forBooker(f.booker.userId, f.sessionId, cancellationPreview.previewVersion),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    if (results[0].status === "fulfilled") {
      expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "STALE_CANCELLATION_PREVIEW" } });
      expect(await refunds(f.sessionId)).toHaveLength(1);
    } else {
      expect(results[0]).toMatchObject({ status: "rejected", reason: { code: "SESSION_CLOSED" } });
      expect(await refunds(f.sessionId)).toHaveLength(2);
    }
  });

  test.each(["admission", "withdrawal"] as const)("serializable %s racing removal preserves unrelated state or rejects the stale target", async (operation) => {
    const f = await cancellationFixture(context);
    const target = f.participants[0]!;
    const newcomer = await context.identity(false);
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    let signal!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { signal = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Model the documented lifecycle-writer contract until Yajie's adapter lands.
    const lifecycle = new PostgresTransactor(context.pool, "serializable").transaction(async (sql) => {
      await sql.query("select session_id from sessions where session_id=$1 for update", [f.sessionId]);
      if (operation === "admission") await addCancellationParticipant(sql, f.sessionId, newcomer);
      else {
        await sql.query("update participations set status='WITHDRAWN',withdrawn_at=$2,replacement_mode='OPEN_SLOT' where participation_id=$1", [target.participationId, clock.now()]);
        await sql.query("update fund_holds set state='AWAITING_REPLACEMENT' where hold_id=$1", [target.holdId]);
      }
      signal();
      await gate;
    });
    await locked;
    const applicationName = `uc2-03b-race-${randomUUID()}`;
    const contender = new Pool({ connectionString: sessionTestEnvironment().databaseUrl, application_name: applicationName, max: 1 });
    const submitted = remove(new PostgresSessionRemovalTransaction(() => contender, clock, randomUUID()))
      .forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion);
    const settled = Promise.allSettled([submitted]);
    let outcome: Awaited<typeof settled>[number];
    try {
      // Prove the contender already holds its transaction snapshot and is waiting
      // on the session lock; merely starting a Promise does not establish a race.
      await expect.poll(async () => (await context.pool.query(
        "select count(*)::int as count from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",
        [applicationName],
      )).rows[0].count, { timeout: 5000 }).toBe(1);
      release();
      await lifecycle;
      [outcome] = await settled;
    } finally {
      release();
      await Promise.allSettled([lifecycle, submitted]);
      await contender.end();
    }
    if (operation === "admission") {
      expect(outcome.status).toBe("fulfilled");
      expect(await refunds(f.sessionId)).toHaveLength(1);
      const items = await list().forBooker(f.booker.userId, f.sessionId);
      expect(items.participants.map((p) => p.status)).toEqual(["REMOVED", "COMMITTED"]);
    } else {
      expect(outcome.status).toBe("rejected");
      expect(await refunds(f.sessionId)).toEqual([]);
      expect((await context.pool.query("select state from fund_holds where hold_id=$1", [target.holdId])).rows[0].state).toBe("AWAITING_REPLACEMENT");
    }
  });

  test("removal leaves the joining queue intact and available for the separate promotion workflow", async () => {
    const f = await cancellationFixture(context, 2);
    const waiting = await context.identity(false);
    const participationId = randomUUID();
    await context.pool.query("insert into participations(participation_id,session_id,user_id,status,attendance,waitlisted_at,queue_sequence) values ($1,$2,$3,'WAITLISTED','UNVERIFIED',now(),1)", [participationId, f.sessionId, waiting.userId]);
    await context.pool.query("update sessions set next_queue_sequence=2 where session_id=$1", [f.sessionId]);
    const before = (await context.pool.query("select * from participations where participation_id=$1", [participationId])).rows[0];
    const target = f.participants[0]!;
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    await remove().forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion);
    expect((await context.pool.query("select * from participations where participation_id=$1", [participationId])).rows[0]).toEqual(before);
    const session = await reads().run(({ sessions }) => sessions.get(f.sessionId));
    expect(session?.getAvailableSlots(clock.now())).toBe(1);
    expect(session?.participantList.nextWaitlisted()?.participationId).toBe(participationId);
  });

  test.each(["missing", "amount", "identity"] as const)("refuses %s ledger projections without mutating the target", async (state) => {
    const f = await cancellationFixture(context);
    const target = f.participants[0]!;
    const quote = await preview().forBooker(f.booker.userId, f.sessionId, target.participationId);
    if (state === "missing") await context.pool.query("delete from hold_balances where hold_id=$1", [target.holdId]);
    else if (state === "amount") await context.pool.query("update hold_balances set original_cents=600,held_cents=600 where hold_id=$1", [target.holdId]);
    else await context.pool.query("update hold_balances set wallet_id=$2 where hold_id=$1", [target.holdId, f.booker.walletId]);
    await expect(remove().forBooker(f.booker.userId, f.sessionId, target.participationId, quote.previewVersion)).rejects.toBeInstanceOf(SessionPersistenceError);
    expect(await refunds(f.sessionId)).toEqual([]);
    expect((await context.pool.query("select status from participations where participation_id=$1", [target.participationId])).rows[0].status).toBe("COMMITTED");
  });
});
