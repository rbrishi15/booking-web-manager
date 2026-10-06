import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Session } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresCommitmentSessionRepository } from "@/lib/sessions/postgres-commitment-session-repository";
import {
  createTestSession,
  createTestUser,
  hoursBeforeSessionStart,
} from "../../domain/sessions/session/session-fixtures";

const stored = vi.hoisted(() => ({ session: undefined as Session | undefined }));
vi.mock("@/lib/sessions/postgres-session-management-repository", () => ({
  PostgresSessionManagementRepository: vi.fn(function () {
    return { get: async () => stored.session ?? null };
  }),
}));

const statements: { text: string; values: readonly unknown[] }[] = [];
const sql: SqlExecutor = {
  query: async (text: string, values: readonly unknown[] = []) => {
    statements.push({ text, values });
    return text.trimStart().startsWith("insert")
      ? []
      : [{ returned: true }];
  },
} as SqlExecutor;

beforeEach(() => {
  statements.length = 0;
  stored.session = undefined;
});

describe("PostgresCommitmentSessionRepository", () => {
  test("save_WhenParticipantCommits_InsertsParticipationThenHoldAndStoresSession", async () => {
    // Arrange
    const { repository, session } = await loadedSession(
      createTestSession({ committedUserIds: ["alice"] }),
    );
    createTestUser({ userId: "bob" })
      .asParticipant()
      .join(session, {
        participationId: "p-bob",
        holdId: "h-bob",
        now: hoursBeforeSessionStart(40),
      });

    // Act
    await repository.save(session);

    // Assert
    expect(kinds()).toEqual([
      "insert into participations",
      "insert into fund_holds",
      "update sessions",
    ]);
    expect(statements[0]?.values.slice(0, 5)).toEqual([
      "p-bob",
      "s",
      "bob",
      "COMMITTED",
      "UNVERIFIED",
    ]);
    expect(statements[1]?.values).toEqual([
      "h-bob",
      "p-bob",
      "platform",
      "w-bob",
      null,
      "500",
      "HELD",
      hoursBeforeSessionStart(40),
      null,
    ]);
    expect(statements[2]?.values).toEqual(["s", "OPEN", 1]);
  });

  test("save_WhenSessionIsFull_InsertsWaitlistedParticipationAndNextQueueSequence", async () => {
    // Arrange
    const { repository, session } = await loadedSession(
      createTestSession({ committedUserIds: ["alice", "bob"] }),
    );
    createTestUser({ userId: "carol" })
      .asParticipant()
      .join(session, {
        participationId: "p-carol",
        holdId: "h-carol",
        now: hoursBeforeSessionStart(40),
      });

    // Act
    await repository.save(session);

    // Assert
    expect(kinds()).toEqual(["insert into participations", "update sessions"]);
    expect(statements[0]?.values.at(-1)).toBe(1);
    expect(statements[1]?.values).toEqual(["s", "OPEN", 2]);
  });

  test("save_WhenParticipantWithdrawsLate_UpdatesParticipationAndHoldOnly", async () => {
    // Arrange
    const { repository, session } = await loadedSession(
      createTestSession({ committedUserIds: ["alice", "bob"] }),
    );
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(session, {
        participationId: "p-alice",
        now: hoursBeforeSessionStart(10),
      });

    // Act
    await repository.save(session);

    // Assert
    expect(kinds()).toEqual([
      "update participations",
      "update fund_holds",
      "update sessions",
    ]);
    expect(statements[0]?.values.slice(0, 4)).toEqual([
      "s",
      "p-alice",
      "alice",
      "WITHDRAWN",
    ]);
    expect(statements[1]?.values).toEqual([
      "h-alice",
      "p-alice",
      "AWAITING_REPLACEMENT",
      null,
      null,
    ]);
  });

  test("save_WhenWaiterIsPromoted_UpdatesParticipationAndInsertsTheirHold", async () => {
    // Arrange
    const { repository, session } = await loadedSession(
      createTestSession({
        committedUserIds: ["alice"],
        waitlistedUserIds: ["carol"],
      }),
    );
    createTestUser({ userId: "carol" })
      .asParticipant()
      .promoteFromWaitlist(session, {
        holdId: "h-carol",
        now: hoursBeforeSessionStart(40),
      });

    // Act
    await repository.save(session);

    // Assert
    expect(kinds()).toEqual([
      "update participations",
      "insert into fund_holds",
      "update sessions",
    ]);
    expect(statements[0]?.values[3]).toBe("COMMITTED");
  });

  test("save_WhenNothingChanged_WritesOnlyTheSessionRow", async () => {
    // Arrange
    const { repository, session } = await loadedSession(
      createTestSession({ committedUserIds: ["alice"] }),
    );

    // Act
    await repository.save(session);

    // Assert
    expect(kinds()).toEqual(["update sessions"]);
  });

  test("save_WhenSessionWasNotLoadedInThisTransaction_Rejects", async () => {
    // Arrange
    const repository = new PostgresCommitmentSessionRepository(sql);

    // Act & Assert
    await expect(
      repository.save(createTestSession({ committedUserIds: ["alice"] })),
    ).rejects.toMatchObject({ name: "SessionPersistenceError" });
    expect(statements).toEqual([]);
  });

  test("save_WhenVisibilityChanged_RejectsWithoutWriting", async () => {
    // Arrange
    const { repository, session } = await loadedSession(
      createTestSession({ committedUserIds: ["alice"] }),
    );
    session.changeVisibility("PRIVATE", hoursBeforeSessionStart(40));

    // Act & Assert
    await expect(repository.save(session)).rejects.toMatchObject({
      name: "SessionPersistenceError",
    });
    expect(statements).toEqual([]);
  });
});

async function loadedSession(session: Session) {
  stored.session = session;
  const repository = new PostgresCommitmentSessionRepository(sql);
  const loaded = await repository.get(session.sessionId);
  if (!loaded) throw new Error("fixture session was not loaded");
  return { repository, session: loaded };
}

/** Each statement's leading verb and table, such as "update sessions". */
function kinds(): string[] {
  return statements.map(({ text }) =>
    text
      .trim()
      .split(/\s+/)
      .slice(0, text.trim().startsWith("insert") ? 3 : 2)
      .join(" "),
  );
}
