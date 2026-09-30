import { Session, type UserDetails } from "@/domain";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { describe, expect, test } from "vitest";
import { createTestUserDetails } from "../domain/accounts/user-fixtures";
import {
  committedParticipation,
  hoursBeforeSessionStart,
  sessionDetails,
} from "../domain/sessions/session/session-fixtures";
import { InMemoryUnitOfWork } from "./support/in-memory-unit-of-work";

// sessionDetails() books a 1000-cent venue, so each share is 1000 / totalSlots.
const sessionId = "s";

// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-04 Commit to Session", () => {
  test("locks the participant's share and creates the commitment row in one transaction", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act
    const result = await commitToSession.forParticipant(
      commitRequest("alice"),
    );

    // Assert
    expect(result).toEqual({
      kind: "COMMITTED",
      sessionId,
      participationId: "id-1",
      heldCents: 500,
      refundedParticipationId: undefined,
    });
    const participation = unitOfWork
      .requireSession(sessionId)
      .participantList.requireParticipation("id-1");
    expect(participation.status).toBe("COMMITTED");
    expect(participation.hold?.state).toBe("HELD");
    expect(participation.hold?.amount.toCents()).toBe(500);
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
    expect(unitOfWork.ledgerInstructions[0]).toMatchObject({
      kind: "LOCK",
      walletId: "w-alice",
      holdId: "id-2",
      participationId: "id-1",
    });
    expect(unitOfWork.availableCents("alice")).toBe(9_500);
  });

  test("rolls back the commitment when its fund lock cannot be written", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });
    unitOfWork.failNextLedgerAppend = true;

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice")),
    ).rejects.toThrow("Ledger append failed");
    expect(
      unitOfWork.requireSession(sessionId).participantList.participations,
    ).toHaveLength(0);
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    expect(unitOfWork.availableCents("alice")).toBe(10_000);
  });

  test("commits a slot only when capacity remains, otherwise adds to the waitlist FIFO on joined_at", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      session: fullSession(),
      users: ["carol", "dave"].map((userId) =>
        createTestUserDetails({ userId }),
      ),
    });

    // Act
    const carol = await commitToSession.forParticipant(commitRequest("carol"));
    const dave = await commitToSession.forParticipant(commitRequest("dave"));

    // Assert
    expect(carol).toMatchObject({ kind: "WAITLISTED", heldCents: 0 });
    expect(dave).toMatchObject({ kind: "WAITLISTED", heldCents: 0 });
    const list = unitOfWork.requireSession(sessionId).participantList;
    expect(list.committedCount).toBe(2);
    expect(list.requireParticipation(carol.participationId).queueSequence).toBe(
      1,
    );
    expect(list.requireParticipation(dave.participationId).queueSequence).toBe(
      2,
    );
    expect(list.nextWaitlisted()?.userId).toBe("carol");
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
    expect(unitOfWork.availableCents("carol")).toBe(10_000);
  });

  test("rejects a commit when the wallet's available balance is insufficient", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice", availableFundsCents: 499 })],
    });

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice")),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(
      unitOfWork.requireSession(sessionId).participantList.participations,
    ).toHaveLength(0);
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("rejects a private session without its room token or group membership", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      session: new Session(sessionDetails({ visibility: "PRIVATE" })),
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice")),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS" });
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("admits to a private session with its room token", async () => {
    // Arrange
    const { commitToSession } = commitmentScenario({
      session: new Session(sessionDetails({ visibility: "PRIVATE" })),
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act
    const result = await commitToSession.forParticipant({
      ...commitRequest("alice"),
      roomToken: "room",
    });

    // Assert
    expect(result.kind).toBe("COMMITTED");
  });

  test("a repeated request with the same idempotency key returns the original result without re-locking funds", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });
    const first = await commitToSession.forParticipant(commitRequest("alice"));

    // Act
    const retry = await commitToSession.forParticipant(commitRequest("alice"));

    // Assert
    expect(retry).toEqual(first);
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
    expect(unitOfWork.availableCents("alice")).toBe(9_500);
  });

  test("a new idempotency key for a participant who already committed is rejected without locking again", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });
    await commitToSession.forParticipant(commitRequest("alice", "first"));

    // Act & Assert
    await expect(
      commitToSession.forParticipant(commitRequest("alice", "second")),
    ).rejects.toMatchObject({ code: "ALREADY_PARTICIPATING" });
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
    expect(unitOfWork.availableCents("alice")).toBe(9_500);
  });

  test("rejects an unknown session without writing anything", async () => {
    // Arrange
    const { commitToSession, unitOfWork } = commitmentScenario({
      users: [createTestUserDetails({ userId: "alice" })],
    });

    // Act & Assert
    await expect(
      commitToSession.forParticipant({
        ...commitRequest("alice"),
        sessionId: "missing",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  // The priority test — see CLAUDE.md "Testing". Filtered by `npm run test:concurrency`.
  test("concurrency: 20 concurrent commits on an 8-slot session — exactly 8 succeed, 12 waitlist, total locked = 8 × share", async () => {
    // Arrange
    const userIds = Array.from({ length: 20 }, (_, index) => `user-${index}`);
    const { commitToSession, unitOfWork } = commitmentScenario({
      session: new Session(sessionDetails({ totalSlots: 8 })),
      users: userIds.map((userId) => createTestUserDetails({ userId })),
    });
    const share = 125;

    // Act
    const results = await Promise.all(
      userIds.map((userId) =>
        commitToSession.forParticipant(commitRequest(userId)),
      ),
    );

    // Assert
    const committed = results.filter((result) => result.kind === "COMMITTED");
    const waitlisted = results.filter((result) => result.kind === "WAITLISTED");
    expect(committed).toHaveLength(8);
    expect(waitlisted).toHaveLength(12);
    const locks = unitOfWork.ledgerInstructions.filter(
      (instruction) => instruction.kind === "LOCK",
    );
    const totalLocked = locks.reduce(
      (sum, instruction) => sum + instruction.amount.toCents(),
      0,
    );
    expect(totalLocked).toBe(8 * share);
    expect(new Set(locks.map((lock) => lock.walletId)).size).toBe(8);
    const list = unitOfWork.requireSession(sessionId).participantList;
    expect(list.committedCount).toBe(8);
    expect(
      list.participations
        .filter((participation) => participation.status === "WAITLISTED")
        .map((participation) => participation.queueSequence)
        .sort((a, b) => (a ?? 0) - (b ?? 0)),
    ).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });
});

function commitmentScenario(options: {
  users: readonly UserDetails[];
  session?: Session;
}) {
  const unitOfWork = new InMemoryUnitOfWork({
    users: options.users,
    sessions: [options.session ?? new Session(sessionDetails())],
  });
  let nextId = 0;
  const commitToSession = new CommitToSession({
    unitOfWork,
    clock: { now: () => hoursBeforeSessionStart(48) },
    ids: { next: () => `id-${++nextId}` },
  });
  return { commitToSession, unitOfWork };
}

function commitRequest(userId: string, idempotencyKey = `commit-${userId}`) {
  return { userId, sessionId, idempotencyKey };
}

/** A two-slot session whose slots alice and bob already hold. */
function fullSession(): Session {
  const details = sessionDetails();
  const terms = {
    holdingAccountId: details.holdingAccountId,
    bookingShare: details.booking.totalCost.divideFloor(details.totalSlots),
  };
  return new Session({
    ...details,
    participations: ["alice", "bob"].map((userId) =>
      committedParticipation(terms, userId),
    ),
  });
}
