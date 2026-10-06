import { describe, expect, test } from "vitest";
import type { Session, User } from "@/domain";
import { PreviewWithdrawal } from "@/use-cases/sessions/WithdrawalPreview";
import {
  createTestSession,
  createTestUser,
  hoursBeforeSessionStart,
  sessionStartsAt,
  sessionState,
} from "../domain/sessions/session/session-fixtures";

// A two-slot session for a 1000-cent booking: each share is 500 cents.
// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-05 Withdraw from Session — refund preview", () => {
  test("shows a full refund more than 30h before start", async () => {
    // Arrange
    const { preview, session } = previewScenario(hoursBeforeSessionStart(31));

    // Act
    const result = await preview.forParticipant("alice", session.sessionId);

    // Assert
    expect(result).toEqual({
      sessionId: "s",
      participationId: "p-alice",
      kind: "REFUNDED",
      refundCents: 500,
      heldCents: 500,
    });
  });

  test("shows the share staying held at 30h or less", async () => {
    // Arrange
    const { preview, session } = previewScenario(hoursBeforeSessionStart(30));

    // Act
    const result = await preview.forParticipant("alice", session.sessionId);

    // Assert
    expect(result).toMatchObject({
      kind: "AWAITING_REPLACEMENT",
      refundCents: 0,
      heldCents: 500,
    });
  });

  test("changes nothing", async () => {
    // Arrange
    const { preview, session } = previewScenario(hoursBeforeSessionStart(31));
    const before = sessionState(session);

    // Act
    await preview.forParticipant("alice", session.sessionId);

    // Assert
    expect(sessionState(session)).toEqual(before);
  });

  test("rejects a user who is not participating", async () => {
    // Arrange
    const { preview, session } = previewScenario(hoursBeforeSessionStart(31));

    // Act & Assert
    await expect(
      preview.forParticipant("bob", session.sessionId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("rejects a participant who has already withdrawn", async () => {
    // Arrange
    const now = hoursBeforeSessionStart(10);
    const { preview, session } = previewScenario(now);
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(session, { participationId: "p-alice", now });

    // Act & Assert
    await expect(
      preview.forParticipant("alice", session.sessionId),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  test("rejects a preview once the session has started", async () => {
    // Arrange
    const { preview, session } = previewScenario(sessionStartsAt);

    // Act & Assert
    await expect(
      preview.forParticipant("alice", session.sessionId),
    ).rejects.toMatchObject({ code: "SESSION_STARTED" });
  });

  test("rejects an unknown session", async () => {
    // Arrange
    const { preview } = previewScenario(hoursBeforeSessionStart(31));

    // Act & Assert
    await expect(
      preview.forParticipant("alice", "missing"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/** alice holds one of two places; bob exists but has not joined. */
function previewScenario(now: Date) {
  const session = createTestSession({ committedUserIds: ["alice"] });
  const users = new Map<string, User>(
    ["alice", "bob"].map((userId) => [userId, createTestUser({ userId })]),
  );
  const sessions = new Map<string, Session>([[session.sessionId, session]]);
  const preview = new PreviewWithdrawal({
    transaction: {
      run: (work) =>
        work({
          users: { get: async (id) => users.get(id) ?? null },
          sessions: { get: async (id) => sessions.get(id) ?? null },
        }),
    },
    clock: { now: () => now },
  });
  return { preview, session };
}
