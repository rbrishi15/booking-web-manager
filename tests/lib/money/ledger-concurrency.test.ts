import { Money, type FinancialInstruction } from "@/domain";
import { LedgerError, LedgerUnitOfWork, PLATFORM_HOLDING_ACCOUNT_ID } from "@/lib/money";
import { FakeLedgerDatabase } from "./support/fake-ledger-database";
import { describe, expect, test } from "vitest";

/**
 * The priority test from CLAUDE.md: twenty concurrent commitments at an
 * eight-slot session, asserting that exactly eight succeed and that the total
 * locked equals eight shares.
 *
 * This is the CI-safe half. It runs against `FakeLedgerDatabase`, which models
 * row locking but re-implements the apply trigger in TypeScript, so it proves
 * the adapter and the locking discipline rather than the SQL.
 * `ledger-concurrency.db.test.ts` runs the same scenarios against real
 * Postgres and is what proves the schema.
 */

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SHARE = Money.fromCents(1250);
const CAPACITY = 8;
const CONTENDERS = 20;
const OCCURRED_AT = new Date("2026-09-17T12:00:00.000Z");

type CommitOutcome = { readonly outcome: "COMMITTED" | "WAITLISTED" };

describe("ledger concurrency", () => {
  test("concurrency: twenty simultaneous commitments fill eight slots exactly", async () => {
    // Arrange
    const database = new FakeLedgerDatabase();
    const unitOfWork = new LedgerUnitOfWork(database);
    database.addSession(SESSION_ID, CAPACITY);

    const participants = Array.from({ length: CONTENDERS }, (_unused, index) =>
      participant(index),
    );
    for (const person of participants) {
      database.addWallet(person.walletId, SHARE.toCents() * 4);
    }

    // Act
    const outcomes = await Promise.all(
      participants.map((person) => commit(unitOfWork, person)),
    );

    // Assert
    const committed = outcomes.filter((it) => it.outcome === "COMMITTED");
    const waitlisted = outcomes.filter((it) => it.outcome === "WAITLISTED");

    expect(committed).toHaveLength(CAPACITY);
    expect(waitlisted).toHaveLength(CONTENDERS - CAPACITY);
    expect(database.totalHeldFor(SESSION_ID)).toBe(CAPACITY * SHARE.toCents());
    expect(database.entries).toHaveLength(CAPACITY);
    expect(database.sessions.get(SESSION_ID)?.committed).toBe(CAPACITY);
  });

  test("concurrency: a commitment and its fund lock move together or not at all", async () => {
    // Arrange
    const database = new FakeLedgerDatabase();
    const unitOfWork = new LedgerUnitOfWork(database);
    database.addSession(SESSION_ID, CAPACITY);

    const participants = Array.from({ length: CONTENDERS }, (_unused, index) =>
      participant(index),
    );
    // Only the first six can afford their share. The rest reach the ledger and
    // are rejected there, after the slot counter has already been incremented,
    // so the rollback has to take the slot back with it.
    for (const [index, person] of participants.entries()) {
      database.addWallet(person.walletId, index < 6 ? SHARE.toCents() : 0);
    }

    // Act
    const results = await Promise.allSettled(
      participants.map((person) => commit(unitOfWork, person)),
    );

    // Assert
    const rejected = rejectionsOf(results);

    expect(results).toHaveLength(CONTENDERS);
    expect(rejected).toHaveLength(CONTENDERS - 6);
    for (const failure of rejected) {
      expect(failure.reason).toBeInstanceOf(LedgerError);
      expect((failure.reason as LedgerError).code).toBe("INSUFFICIENT_FUNDS");
    }

    // No slot was consumed by a commitment whose lock failed.
    expect(database.sessions.get(SESSION_ID)?.committed).toBe(6);
    expect(database.entries).toHaveLength(6);
    expect(database.totalHeldFor(SESSION_ID)).toBe(6 * SHARE.toCents());
  });

  test("concurrency: simultaneous locks cannot overdraw one wallet", async () => {
    // Arrange
    const database = new FakeLedgerDatabase();
    const unitOfWork = new LedgerUnitOfWork(database);

    const walletId = "22222222-2222-4222-8222-222222222222";
    const affordable = 3;
    database.addWallet(walletId, SHARE.toCents() * affordable);

    // Act
    const results = await Promise.allSettled(
      Array.from({ length: CONTENDERS }, (_unused, index) =>
        unitOfWork.execute(
          {
            idempotencyKey: `lock-${index}`,
            scope: "UC2-04:commit",
            request: { index },
          },
          async ({ ledger }) => {
            await ledger.append([
              lockInstruction({
                walletId,
                sessionId: `session-${index}`,
                holdId: `hold-${index}`,
                participationId: `participation-${index}`,
              }),
            ]);
            return { locked: true };
          },
        ),
      ),
    );

    // Assert
    const rejected = rejectionsOf(results);

    expect(results).toHaveLength(CONTENDERS);
    expect(rejected).toHaveLength(CONTENDERS - affordable);
    expect(database.balanceOf(walletId)).toBe(0);
    expect(database.entries).toHaveLength(affordable);

    for (const failure of rejected) {
      expect((failure.reason as LedgerError).code).toBe("INSUFFICIENT_FUNDS");
    }
  });

  test("concurrency: a replayed commitment returns the first result without a second lock", async () => {
    // Arrange
    const database = new FakeLedgerDatabase();
    const unitOfWork = new LedgerUnitOfWork(database);
    database.addSession(SESSION_ID, CAPACITY);

    const person = participant(0);
    database.addWallet(person.walletId, SHARE.toCents() * 4);

    // Act
    const first = await commit(unitOfWork, person);
    const replay = await commit(unitOfWork, person);

    // Assert
    expect(first).toEqual({ outcome: "COMMITTED" });
    expect(replay).toEqual(first);
    expect(database.entries).toHaveLength(1);
    expect(database.balanceOf(person.walletId)).toBe(SHARE.toCents() * 3);
  });
});

interface Participant {
  readonly userId: string;
  readonly walletId: string;
  readonly participationId: string;
  readonly holdId: string;
}

function participant(index: number): Participant {
  const suffix = String(index).padStart(2, "0");
  return {
    userId: `user-${suffix}`,
    walletId: `aaaaaaaa-0000-4000-8000-0000000000${suffix}`,
    participationId: `bbbbbbbb-0000-4000-8000-0000000000${suffix}`,
    holdId: `cccccccc-0000-4000-8000-0000000000${suffix}`,
  };
}

/**
 * A stand-in for UC2-04, which belongs to the commitment role and does not
 * exist yet. It does the one thing this test needs to be honest about: it reads
 * the slot count, yields, and only then writes, so an unlocked implementation
 * would let all twenty through.
 */
async function commit(
  unitOfWork: LedgerUnitOfWork,
  person: Participant,
): Promise<CommitOutcome> {
  return unitOfWork.execute(
    {
      idempotencyKey: `commit:${SESSION_ID}:${person.userId}`,
      scope: "UC2-04:commit",
      request: { sessionId: SESSION_ID, userId: person.userId },
    },
    async ({ sql, ledger }): Promise<CommitOutcome> => {
      const rows = await sql.query<{ capacity: unknown; committed: unknown }>(
        "select capacity, committed from fake_sessions where session_id = $1 for update",
        [SESSION_ID],
      );

      const row = rows[0];
      if (row === undefined) throw new Error("The session does not exist");

      const capacity = Number(row.capacity);
      const committed = Number(row.committed);

      // The interleaving point. Every contender reaches here before any of them
      // writes, so without the row lock the slot count would be read as zero
      // twenty times over.
      await tick();

      if (committed >= capacity) return { outcome: "WAITLISTED" };

      await sql.query(
        "update fake_sessions set committed = committed + 1 where session_id = $1",
        [SESSION_ID],
      );

      await ledger.append([
        lockInstruction({
          walletId: person.walletId,
          sessionId: SESSION_ID,
          holdId: person.holdId,
          participationId: person.participationId,
        }),
      ]);

      return { outcome: "COMMITTED" };
    },
  );
}

function lockInstruction(references: {
  walletId: string;
  sessionId: string;
  holdId: string;
  participationId: string;
}): FinancialInstruction {
  return {
    kind: "LOCK",
    sessionId: references.sessionId,
    participationId: references.participationId,
    holdId: references.holdId,
    holdingAccountId: PLATFORM_HOLDING_ACCOUNT_ID,
    walletId: references.walletId,
    amount: SHARE,
    occurredAt: OCCURRED_AT,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Written as an explicit predicate so the narrowing does not depend on the
 * TypeScript version's inference of one. */
function rejectionsOf(
  results: readonly PromiseSettledResult<unknown>[],
): readonly PromiseRejectedResult[] {
  return results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
}
