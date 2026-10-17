import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresCommitmentUnitOfWork } from "@/lib/sessions/postgres-commitment-unit-of-work";
import { PostgresSessionManagementTransaction } from "@/lib/sessions/postgres-session-management-transaction";
import { PostgresSessionCancellationTransaction } from "@/lib/sessions/postgres-session-cancellation-transaction";
import { PostgresSessionRemovalReadTransaction } from "@/lib/sessions/postgres-session-removal-read-transaction";
import { PostgresSessionRemovalTransaction } from "@/lib/sessions/postgres-session-removal-transaction";
import { SessionCancellationVersioner } from "@/lib/sessions/cancellation-versioner";
import { ParticipantRemovalVersioner } from "@/lib/sessions/removal-versioner";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { ToggleSessionVisibility } from "@/use-cases/sessions/ToggleSessionVisibility";
import { CancelSession } from "@/use-cases/sessions/CancelSession";
import { PreviewSessionCancellation } from "@/use-cases/sessions/PreviewSessionCancellation";
import { RemoveParticipant } from "@/use-cases/sessions/RemoveParticipant";
import { PreviewParticipantRemoval } from "@/use-cases/sessions/PreviewParticipantRemoval";
import type { UnitOfWork } from "@/use-cases/shared/contracts";
import { cancellationFixture } from "../support/cancellation-fixtures";
import { sessionTestContext, sessionTestEnvironment, type SessionTestContext } from "../support/session-test-context";

const clock = { now: () => new Date("2045-04-01T00:00:00Z") };
type ManagementAction = "visibility" | "cancellation" | "removal";

describe("Production session writers with mixed transaction isolation", () => {
  let context: SessionTestContext;
  beforeAll(() => { context = sessionTestContext(); });
  afterAll(async () => { await context?.pool.end(); });

  test.each(["visibility", "cancellation", "removal"] as const)(
    "READ COMMITTED admission makes SERIALIZABLE %s recheck the committed session",
    async (action) => {
      const fixture = await cancellationFixture(context);
      const entrant = await context.identity(false);
      await context.pool.query(
        "insert into ledger_entries(kind,amount_cents,occurred_at,idempotency_key,external_reference,wallet_id) values ('TOP_UP',500,$1,$2,$3,$4)",
        [clock.now(), randomUUID(), randomUUID(), entrant.walletId],
      );
      const submit = await managementSubmission(action, fixture);
      const gate = commitGate();
      const actual = new PostgresCommitmentUnitOfWork(() => context.pool, clock);
      const unitOfWork: UnitOfWork = {
        execute: (key, work) => actual.execute(key, (transaction) => gate.after(() => work(transaction))),
      };
      const admission = new CommitToSession({ unitOfWork, clock, ids: { next: randomUUID } })
        .forParticipant({ userId: entrant.userId, sessionId: fixture.sessionId, idempotencyKey: randomUUID() });
      const applicationName = `mixed-session-${randomUUID()}`;
      const contender = new Pool({ connectionString: sessionTestEnvironment().databaseUrl, application_name: applicationName, max: 1 });
      let submitted: Promise<unknown> | undefined;
      try {
        // The production writer has persisted both children and the parent but
        // retains its row lock until this test permits the real transaction to commit.
        await Promise.race([gate.ready, admission]);
        submitted = submit(contender).then((value) => ({ value }), (error: unknown) => ({ error }));
        await expect.poll(async () => (await context.pool.query(
          "select count(*)::int as count from pg_stat_activity where application_name=$1 and wait_event_type='Lock'",
          [applicationName],
        )).rows[0].count, { timeout: 5000 }).toBe(1);
        gate.release();
        expect(await admission).toMatchObject({ kind: "COMMITTED", heldCents: 500 });
        const outcome = await submitted;

        if (action === "visibility") {
          expect(outcome).toMatchObject({ error: { code: "CAPACITY_EXCEEDED" } });
        } else if (action === "cancellation") {
          expect(outcome).toMatchObject({ error: { code: "STALE_CANCELLATION_PREVIEW" } });
        } else {
          expect(outcome).toMatchObject({ value: { status: "REMOVED", refundCents: 500 } });
        }
        expect((await context.pool.query("select status,visibility from sessions where session_id=$1", [fixture.sessionId])).rows)
          .toEqual([{ status: "OPEN", visibility: "PUBLIC" }]);
        expect((await context.pool.query(
          "select user_id,status from participations where session_id=$1 order by list_position", [fixture.sessionId],
        )).rows).toEqual([
          { user_id: fixture.participants[0]!.userId, status: action === "removal" ? "REMOVED" : "COMMITTED" },
          { user_id: entrant.userId, status: "COMMITTED" },
        ]);
        expect((await context.pool.query(
          "select count(*)::int as count from ledger_entries where session_id=$1 and kind='REFUND'", [fixture.sessionId],
        )).rows[0].count).toBe(action === "removal" ? 1 : 0);
        expect((await context.pool.query("select available_cents from wallet_balances where wallet_id=$1", [entrant.walletId])).rows[0])
          .toEqual({ available_cents: "0" });
      } finally {
        gate.release();
        await Promise.allSettled([admission, submitted]);
        await contender.end();
      }
    },
  );

  async function managementSubmission(action: ManagementAction, fixture: Awaited<ReturnType<typeof cancellationFixture>>) {
    const { booker, sessionId } = fixture;
    if (action === "visibility") {
      return (pool: Pool) => new ToggleSessionVisibility({
        transaction: new PostgresSessionManagementTransaction(() => pool, clock), clock,
      }).forBooker(booker.userId, sessionId, "PRIVATE");
    }
    if (action === "cancellation") {
      const versioner = new SessionCancellationVersioner();
      const quote = await new PreviewSessionCancellation({
        transaction: new PostgresSessionManagementTransaction(() => context.pool, clock), clock, versioner,
      }).forBooker(booker.userId, sessionId);
      return (pool: Pool) => new CancelSession({
        transaction: new PostgresSessionCancellationTransaction(() => pool, clock, randomUUID()), clock, versioner,
      }).forBooker(booker.userId, sessionId, quote.previewVersion);
    }
    const versioner = new ParticipantRemovalVersioner();
    const participationId = fixture.participants[0]!.participationId;
    const quote = await new PreviewParticipantRemoval({
      transaction: new PostgresSessionRemovalReadTransaction(() => context.pool, clock), clock, versioner,
    }).forBooker(booker.userId, sessionId, participationId);
    return (pool: Pool) => new RemoveParticipant({
      transaction: new PostgresSessionRemovalTransaction(() => pool, clock, randomUUID()), clock, versioner,
    }).forBooker(booker.userId, sessionId, participationId, quote.previewVersion);
  }
});

/** Pauses a real writer after its application work, before its transaction commits. */
function commitGate() {
  let signal!: () => void;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { signal = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    ready,
    release,
    async after<T>(work: () => Promise<T>): Promise<T> {
      const result = await work();
      signal();
      await gate;
      return result;
    },
  };
}
