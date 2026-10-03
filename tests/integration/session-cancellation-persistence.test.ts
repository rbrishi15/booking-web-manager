import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SessionCancellationVersioner } from "@/lib/sessions/cancellation-versioner";
import { PostgresSessionCancellationTransaction } from "@/lib/sessions/postgres-session-cancellation-transaction";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { SessionPersistenceError } from "@/lib/sessions/postgres-row-values";
import { CancelSession } from "@/use-cases/sessions/CancelSession";
import { PreviewSessionCancellation } from "@/use-cases/sessions/PreviewSessionCancellation";
import { ToggleSessionVisibility } from "@/use-cases/sessions/ToggleSessionVisibility";
import type { SessionCancellationTransaction } from "@/use-cases/sessions/session-cancellation-transaction";
import { cancellationFixture, addCancellationParticipant } from "../support/cancellation-fixtures";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

const clock = { now: () => new Date("2045-04-01T00:00:00Z") };
const versioner = new SessionCancellationVersioner();
describe("UC2-03c PostgreSQL cancellation", () => {
  let context: SessionTestContext;
  beforeAll(() => { context = sessionTestContext(); });
  afterAll(async () => { await context?.pool.end(); });
  function management() { return new PostgresSessionManagementTransaction(() => context.pool, clock); }
  function cancellation(key = randomUUID()) { return new PostgresSessionCancellationTransaction(() => context.pool, clock, key); }
  function preview() { return new PreviewSessionCancellation({ transaction: management(), clock, versioner }); }
  function cancel(transaction: SessionCancellationTransaction = cancellation()) { return new CancelSession({ transaction, clock, versioner }); }
  async function refundRows(sessionId: string) {
    return (await context.pool.query("select * from ledger_entries where session_id=$1 and kind='REFUND' order by entry_id", [sessionId])).rows;
  }

  test("preview has no writes; cancellation preserves unrelated fields and reconciles actual wallet refunds", async () => {
    const fixture = await cancellationFixture(context, 2);
    const before = (await context.pool.query("select * from sessions where session_id=$1", [fixture.sessionId])).rows[0];
    const children = (await context.pool.query("select * from participations where session_id=$1 order by list_position", [fixture.sessionId])).rows;
    const quoted = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    expect(quoted).toMatchObject({ affectedParticipantCount: 2, refundRecipientCount: 2, totalRefundCents: 1000 });
    expect(await refundRows(fixture.sessionId)).toEqual([]);
    const submitted = cancel();
    expect(await submitted.forBooker(fixture.booker.userId, fixture.sessionId, quoted.previewVersion))
      .toMatchObject({ status: "CANCELLED", totalRefundCents: 1000 });
    expect((await context.pool.query("select * from sessions where session_id=$1", [fixture.sessionId])).rows[0])
      .toEqual({ ...before, status: "CANCELLED" });
    expect((await context.pool.query("select * from participations where session_id=$1 order by list_position", [fixture.sessionId])).rows)
      .toEqual(children.map((child) => ({ ...child, status: "CANCELLED" })));
    for (const participant of fixture.participants) {
      expect((await context.pool.query("select available_cents from wallet_balances where wallet_id=$1", [participant.walletId])).rows[0])
        .toEqual({ available_cents: "500" });
      expect((await context.pool.query("select state,settled_at from fund_holds where hold_id=$1", [participant.holdId])).rows[0])
        .toEqual({ state: "REFUNDED", settled_at: clock.now() });
      expect((await context.pool.query("select held_cents,settled_kind from hold_balances where hold_id=$1", [participant.holdId])).rows[0])
        .toEqual({ held_cents: "0", settled_kind: "REFUND" });
    }
    expect(await refundRows(fixture.sessionId)).toHaveLength(2);
    expect(await submitted.forBooker(fixture.booker.userId, fixture.sessionId, quoted.previewVersion)).toMatchObject({ totalRefundCents: 1000 });
    expect(await refundRows(fixture.sessionId)).toHaveLength(2);
    await context.pool.query("update profiles set account_status='INACTIVE' where user_id=$1", [fixture.booker.userId]);
    await expect(submitted.forBooker(fixture.booker.userId, fixture.sessionId, quoted.previewVersion)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
  });

  test("cancels waiting/withdrawn records, clears reservations and leaves removed history untouched", async () => {
    const fixture = await cancellationFixture(context, 2);
    const [removed, withdrawn] = fixture.participants;
    if (!removed || !withdrawn) throw new Error("Fixture needs two participants");
    await context.pool.query(
      "insert into ledger_entries(kind,amount_cents,occurred_at,idempotency_key,wallet_id,hold_id,holding_account_id,session_id,participation_id) select 'REFUND',amount_cents,now(),$1,wallet_id,hold_id,holding_account_id,$2,participation_id from fund_holds where hold_id=$3",
      [randomUUID(), fixture.sessionId, removed.holdId],
    );
    await context.pool.query("update fund_holds set state='REFUNDED',settled_at=now() where hold_id=$1", [removed.holdId]);
    await context.pool.query("update participations set status='REMOVED' where participation_id=$1", [removed.participationId]);
    const invitee = await context.identity(false);
    await context.pool.query("update participations set status='WITHDRAWN',withdrawn_at=$2,replacement_mode='DIRECT_INVITE',replacement_invitee_id=$3 where participation_id=$1",
      [withdrawn.participationId, clock.now(), invitee.userId]);
    await context.pool.query("update fund_holds set state='AWAITING_REPLACEMENT' where hold_id=$1", [withdrawn.holdId]);
    const waiting = await context.identity(false);
    await context.pool.query("insert into participations(participation_id,session_id,user_id,status,attendance,waitlisted_at,queue_sequence) values ($1,$2,$3,'WAITLISTED','UNVERIFIED',now(),1)",
      [randomUUID(), fixture.sessionId, waiting.userId]);
    await context.pool.query("update sessions set next_queue_sequence=2 where session_id=$1", [fixture.sessionId]);
    const original = (await context.pool.query("select * from participations where participation_id=$1", [removed.participationId])).rows[0];
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    expect(quote).toMatchObject({ affectedParticipantCount: 2, refundRecipientCount: 1, totalRefundCents: 500 });
    await cancel().forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion);
    expect((await context.pool.query("select * from participations where participation_id=$1", [removed.participationId])).rows[0]).toEqual(original);
    expect((await context.pool.query("select status,replacement_mode,replacement_invitee_id,withdrawn_at from participations where participation_id=$1", [withdrawn.participationId])).rows[0])
      .toEqual({ status: "CANCELLED", replacement_mode: null, replacement_invitee_id: null, withdrawn_at: clock.now() });
    expect(await refundRows(fixture.sessionId)).toHaveLength(2);
    const loaded = await management().run(({ sessions }) => sessions.get(fixture.sessionId));
    expect(loaded?.participantList.requireParticipation(removed.participationId).status).toBe("REMOVED");
  });

  test.each(["ledger", "children", "response"] as const)("rolls back %s-stage failure, including replay data and all refunds", async (stage) => {
    const fixture = await cancellationFixture(context);
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    const key = randomUUID();
    const failure = new Error("Injected persistence failure");
    const actual = cancellation(key);
    const failing: SessionCancellationTransaction = { run: (work) => actual.run(async (repositories) => {
      const result = await work({ ...repositories,
        ledger: { append: async (instructions) => { await repositories.ledger.append(instructions); if (stage === "ledger") throw failure; } },
        sessions: { ...repositories.sessions, get: (id) => repositories.sessions.get(id), saveCancellation: async (session) => {
          await repositories.sessions.saveCancellation(session); if (stage === "children") throw failure;
        } },
      });
      if (stage === "response") throw failure;
      return result;
    }) };
    await expect(cancel(failing).forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion)).rejects.toBe(failure);
    expect((await context.pool.query("select status from sessions where session_id=$1", [fixture.sessionId])).rows[0]).toEqual({ status: "OPEN" });
    expect(await refundRows(fixture.sessionId)).toEqual([]);
    expect((await context.pool.query("select count(*)::int as count from idempotency_keys where idempotency_key=$1", [JSON.stringify(["UC2-03c", fixture.booker.userId, key])])).rows[0]).toEqual({ count: 0 });
    expect((await context.pool.query("select state from fund_holds where hold_id=$1", [fixture.participants[0]!.holdId])).rows[0]).toEqual({ state: "HELD" });
  });

  test("concurrent same-key submissions both return the committed response with one refund", async () => {
    const fixture = await cancellationFixture(context);
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    const key = randomUUID();
    const results = await Promise.all([cancel(cancellation(key)), cancel(cancellation(key))].map(
      (useCase) => useCase.forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion),
    ));
    expect(results[0]).toEqual(results[1]);
    expect(await refundRows(fixture.sessionId)).toHaveLength(1);
    await expect(cancel(cancellation(key)).forBooker(fixture.booker.userId, fixture.sessionId, "b".repeat(64)))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("concurrent different keys produce one cancellation and one closed-session conflict", async () => {
    const fixture = await cancellationFixture(context);
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    const results = await Promise.allSettled([cancel(), cancel()].map((useCase) => useCase.forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "SESSION_CLOSED" } });
    expect(await refundRows(fixture.sessionId)).toHaveLength(1);
  });

  test("visibility and cancellation have a valid serial outcome without rewriting each other's fields", async () => {
    const fixture = await cancellationFixture(context);
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    const toggle = new ToggleSessionVisibility({ transaction: management(), clock });
    const results = await Promise.allSettled([
      cancel().forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion),
      toggle.forBooker(fixture.booker.userId, fixture.sessionId, "PRIVATE"),
    ]);
    expect(results[0].status).toBe("fulfilled");
    if (results[1].status === "rejected") expect(results[1].reason).toMatchObject({ code: "SESSION_CLOSED" });
    expect((await context.pool.query("select status from sessions where session_id=$1", [fixture.sessionId])).rows[0]).toEqual({ status: "CANCELLED" });
    expect(await refundRows(fixture.sessionId)).toHaveLength(1);
  });

  test("serializable admission before cancellation invalidates the old preview and causes no partial refunds", async () => {
    const fixture = await cancellationFixture(context);
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    const newParticipant = await context.identity(false);
    let signal!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { signal = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const admission = new PostgresTransactor(context.pool, "serializable").transaction(async (sql) => {
      await sql.query("select session_id from sessions where session_id=$1 for update", [fixture.sessionId]);
      await addCancellationParticipant(sql, fixture.sessionId, newParticipant);
      signal();
      await gate;
    });
    await locked;
    const submitted = cancel().forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion);
    release();
    await admission;
    await expect(submitted).rejects.toMatchObject({ code: "STALE_CANCELLATION_PREVIEW" });
    expect(await refundRows(fixture.sessionId)).toEqual([]);
    const fresh = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    expect(fresh.totalRefundCents).toBe(1000);
    await cancel().forBooker(fixture.booker.userId, fixture.sessionId, fresh.previewVersion);
    expect(await refundRows(fixture.sessionId)).toHaveLength(2);
  });

  test("ledger projection contradictions fail atomically instead of being presented as business conflicts", async () => {
    const fixture = await cancellationFixture(context);
    const participant = fixture.participants[0]!;
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    await context.pool.query(
      "insert into ledger_entries(kind,amount_cents,occurred_at,idempotency_key,wallet_id,hold_id,holding_account_id,session_id,participation_id) select 'REFUND',amount_cents,now(),$1,wallet_id,hold_id,holding_account_id,$2,participation_id from fund_holds where hold_id=$3",
      [randomUUID(), fixture.sessionId, participant.holdId],
    );
    await expect(cancel().forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion)).rejects.toBeInstanceOf(SessionPersistenceError);
    expect((await context.pool.query("select status from sessions where session_id=$1", [fixture.sessionId])).rows[0]).toEqual({ status: "OPEN" });
    expect(await refundRows(fixture.sessionId)).toHaveLength(1);
  });

  test.each(["terminal", "identity", "amount", "missing"] as const)("rejects %s hold/projection contradictions before refunding the remaining roster", async (state) => {
    const fixture = await cancellationFixture(context, 2);
    const hold = fixture.participants[0]!;
    const quote = await preview().forBooker(fixture.booker.userId, fixture.sessionId);
    if (state === "terminal") {
      await context.pool.query("update fund_holds set state='REFUNDED',settled_at=now() where hold_id=$1", [hold.holdId]);
      await context.pool.query("update participations set status='REMOVED' where participation_id=$1", [hold.participationId]);
    } else if (state === "identity") {
      const other = await context.identity(false);
      await context.pool.query("update hold_balances set wallet_id=$2 where hold_id=$1", [hold.holdId, other.walletId]);
    } else if (state === "amount") {
      await context.pool.query("update hold_balances set original_cents=600,held_cents=600 where hold_id=$1", [hold.holdId]);
    } else {
      await context.pool.query("delete from hold_balances where hold_id=$1", [hold.holdId]);
    }
    await expect(cancel().forBooker(fixture.booker.userId, fixture.sessionId, quote.previewVersion)).rejects.toBeInstanceOf(SessionPersistenceError);
    expect((await context.pool.query("select status from sessions where session_id=$1", [fixture.sessionId])).rows[0].status).toBe("OPEN");
    expect(await refundRows(fixture.sessionId)).toEqual([]);
    expect((await context.pool.query("select state from fund_holds where hold_id=$1", [fixture.participants[1]!.holdId])).rows[0].state).toBe("HELD");
  });
});
