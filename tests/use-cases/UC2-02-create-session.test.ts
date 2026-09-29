import { PayoutAccount } from "@/domain";
import {
  CreateSession,
  type CreateSessionRequest,
} from "@/use-cases/sessions/CreateSession";
import { describe, expect, test, vi } from "vitest";
import {
  createTestUser,
  readyBookerUser,
} from "../domain/accounts/user-fixtures";
import {
  hoursBeforeSessionStart,
  sessionStartsAt,
  sessionEndsAt,
} from "../domain/sessions/session/session-fixtures";
import { CreateSessionUnitOfWork } from "./support/create-session-unit-of-work";

const bookerId = "11111111-1111-4111-8111-111111111111";
const otherBookerId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const holdingAccountId = "00000000-0000-4000-8000-000000000001";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-02 Create Session", () => {
  test(
    "computes each participant's share server-side, never trusting a client-supplied amount",
    async () => {
      // Arrange
      const { createSession, unitOfWork } = setup();
      const request = {
        ...creationRequest(),
        bookingShareCents: 1,
        bookingShare: 1,
        share: 1,
      };

      // Act
      const result = await createSession.execute(bookerId, request);

      // Assert
      expect(result.bookingShareCents).toBe(333);
      expect(
        unitOfWork.requireSession(result.sessionId).bookingShare.toCents(),
      ).toBe(333);
    },
  );
  test(
    "computes the share in integer cents via Math.floor(totalCents / slots), never float division",
    async () => {
      // Arrange
      const { createSession, unitOfWork } = setup();
      const request = creationRequest();
      request.booking.totalCostCents = 1001;
      request.totalSlots = 3;

      // Act
      const result = await createSession.execute(bookerId, request);

      // Assert
      const session = unitOfWork.requireSession(result.sessionId);
      expect(session.booking.totalCost.toCents()).toBe(1001);
      expect(session.totalSlots).toBe(3);
      expect(session.bookingShare.toCents()).toBe(333);
      expect(result.bookingShareCents).toBe(333);
    },
  );

  test("persists supplied booking details and optional session settings", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest({
      visibility: "PUBLIC",
      minimumReliability: 75,
      invitedGroupId: groupId,
    });

    // Act
    const result = await createSession.execute(bookerId, request);

    // Assert
    const session = unitOfWork.requireSession(result.sessionId);
    expect(session.bookerId).toBe(bookerId);
    expect(session.booking).toMatchObject({
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: sessionStartsAt,
      endAt: sessionEndsAt,
    });
    expect(session.minimumHeadcount).toBe(2);
    expect(session.visibility).toBe("PUBLIC");
    expect(session.minimumReliability?.toNumber()).toBe(75);
    expect(session.invitedGroupId).toBe(groupId);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("uses server-owned identities and the domain's initial defaults", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = {
      ...creationRequest(),
      sessionId: otherBookerId,
      roomToken: "client-token",
      holdingAccountId: otherBookerId,
      actorUserId: otherBookerId,
      bookerId: otherBookerId,
      status: "SETTLED",
      participations: [{ userId: otherBookerId }],
    };

    // Act
    const result = await createSession.execute(bookerId, request);

    // Assert
    expect(result).toEqual({
      sessionId: "50000000-0000-4000-8000-000000000001",
      roomToken: "50000000-0000-4000-8000-000000000002",
      bookingShareCents: 333,
    });
    const session = unitOfWork.requireSession(result.sessionId);
    expect(session.bookerId).toBe(bookerId);
    expect(session.roomToken).toBe(result.roomToken);
    expect(session.holdingAccountId).toBe(holdingAccountId);
    expect(session.status).toBe("OPEN");
    expect(session.visibility).toBe("PRIVATE");
    expect(session.minimumReliability).toBeUndefined();
    expect(session.invitedGroupId).toBeUndefined();
    expect(session.participantList.participations).toEqual([]);
    expect(session.participantList.nextQueueSequence).toBe(1);
    expect(session.payoutAttemptIds).toEqual([]);
    expect(session.payoutIdempotencyKeys).toEqual([]);
  });

  test("rejects a missing booker without persisting a session", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    unitOfWork.users.clear();

    // Act & Assert
    await expect(
      createSession.execute(bookerId, creationRequest()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(unitOfWork.sessions.size).toBe(0);
    expect(unitOfWork.replayResults.size).toBe(0);
  });

  test("rejects an inactive booker despite a client-supplied active status", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    unitOfWork.users.set(
      bookerId,
      createTestUser({ userId: bookerId, accountStatus: "INACTIVE" }),
    );
    const request = { ...creationRequest(), accountStatus: "ACTIVE" };

    // Act & Assert
    await expect(createSession.execute(bookerId, request)).rejects.toMatchObject({
      code: "INACTIVE_ACCOUNT",
    });
    expect(unitOfWork.sessions.size).toBe(0);
    expect(unitOfWork.replayResults.size).toBe(0);
  });

  test("rejects incomplete payout setup despite client-supplied readiness", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    unitOfWork.users.set(
      bookerId,
      createTestUser({
        userId: bookerId,
        payoutAccount: PayoutAccount.create({
          payoutAccountId: "payout-account",
          userId: bookerId,
          providerAccountReference: "provider",
        }),
      }),
    );
    const request = {
      ...creationRequest(),
      payoutAccount: { setupStatus: "COMPLETE" },
    };

    // Act & Assert
    await expect(createSession.execute(bookerId, request)).rejects.toMatchObject({
      code: "PAYOUT_ACCOUNT_NOT_READY",
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("uses the server clock to reject a session that has just started", async () => {
    // Arrange
    const { createSession, unitOfWork, clock } = setup();
    clock.now.mockReturnValue(sessionStartsAt);
    const request = { ...creationRequest(), now: hoursBeforeSessionStart(48) };

    // Act & Assert
    await expect(createSession.execute(bookerId, request)).rejects.toMatchObject({
      code: "SESSION_STARTED",
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects an invalid booking interval without persisting a session", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest();
    request.booking.endAt = sessionStartsAt;

    // Act & Assert
    await expect(createSession.execute(bookerId, request)).rejects.toThrow(
      "Booking endAt must be after startAt",
    );
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects a blank venue without persisting a session", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest();
    request.booking.venueName = " ";

    // Act & Assert
    await expect(createSession.execute(bookerId, request)).rejects.toThrow(
      "Booking venue, region, and sport are required",
    );
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects zero booking cost without persisting a session", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest();
    request.booking.totalCostCents = 0;

    // Act & Assert
    await expect(createSession.execute(bookerId, request)).rejects.toThrow(
      "Booking totalCost must be positive",
    );
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects capacity beyond the domain limit without persisting a session", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();

    // Act & Assert
    await expect(
      createSession.execute(bookerId, creationRequest({ totalSlots: 9 })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects minimum headcount greater than capacity", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();

    // Act & Assert
    await expect(
      createSession.execute(bookerId, creationRequest({ minimumHeadcount: 4 })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects a positive cost that produces a zero-cent share", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest();
    request.booking.totalCostCents = 2;

    // Act & Assert
    await expect(createSession.execute(bookerId, request)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("replays the original result without creating another session", async () => {
    // Arrange
    const { createSession, unitOfWork, ids, clock } = setup();
    const request = creationRequest();

    // Act
    const first = await createSession.execute(bookerId, request);
    const replay = await createSession.execute(bookerId, request);

    // Assert
    expect(replay).toEqual(first);
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.replayResults.size).toBe(1);
    expect(ids.next).toHaveBeenCalledTimes(2);
    expect(clock.now).toHaveBeenCalledOnce();
  });

  test("reusing a key with changed details still returns the original creation", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest();
    const first = await createSession.execute(bookerId, request);
    const changedRequest = creationRequest({ totalSlots: 2 });

    // Act
    const replay = await createSession.execute(bookerId, changedRequest);

    // Assert
    expect(replay).toEqual(first);
    expect(replay.bookingShareCents).toBe(333);
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.requireSession(first.sessionId).totalSlots).toBe(3);
  });

  test("allows a new creation with a new idempotency key", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const first = await createSession.execute(bookerId, creationRequest());

    // Act
    const second = await createSession.execute(
      bookerId,
      creationRequest({ idempotencyKey: "second-session" }),
    );

    // Assert
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.roomToken).not.toBe(first.roomToken);
    expect(unitOfWork.sessions.size).toBe(2);
  });

  test("isolates the same idempotency key between different actors", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    unitOfWork.users.set(otherBookerId, readyBookerUser(otherBookerId));
    const first = await createSession.execute(bookerId, creationRequest());

    // Act
    const second = await createSession.execute(otherBookerId, creationRequest());

    // Assert
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(unitOfWork.requireSession(first.sessionId).bookerId).toBe(bookerId);
    expect(unitOfWork.requireSession(second.sessionId).bookerId).toBe(otherBookerId);
    expect(unitOfWork.sessions.size).toBe(2);
    expect(unitOfWork.replayResults.size).toBe(2);
  });

  test("namespaces creation keys separately from other use cases", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest();
    unitOfWork.replayResults.set(
      JSON.stringify(["UC2-04", bookerId, request.idempotencyKey]),
      { participationId: "unrelated-result" },
    );

    // Act
    const result = await createSession.execute(bookerId, request);

    // Assert
    expect(result.bookingShareCents).toBe(333);
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.replayResults.size).toBe(2);
  });

  test("a failed save leaves no committed session or replay result", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    unitOfWork.failNextSave = true;

    // Act & Assert
    await expect(
      createSession.execute(bookerId, creationRequest()),
    ).rejects.toThrow("Session save failed");
    expect(unitOfWork.sessions.size).toBe(0);
    expect(unitOfWork.replayResults.size).toBe(0);
  });

  test("a failed save can be retried with the same idempotency key", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();
    const request = creationRequest();
    unitOfWork.failNextSave = true;
    await expect(createSession.execute(bookerId, request)).rejects.toThrow(
      "Session save failed",
    );

    // Act
    const result = await createSession.execute(bookerId, request);

    // Assert
    expect(unitOfWork.requireSession(result.sessionId).bookingShare.toCents()).toBe(
      333,
    );
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.replayResults.size).toBe(1);
  });

  test("creates a session without moving funds or requesting a payout", async () => {
    // Arrange
    const { createSession, unitOfWork } = setup();

    // Act
    await createSession.execute(bookerId, creationRequest());

    // Assert
    expect(unitOfWork.ledgerAppend).not.toHaveBeenCalled();
    expect(unitOfWork.payoutIntentAppend).not.toHaveBeenCalled();
  });
});

function creationRequest(
  overrides: Partial<CreateSessionRequest> = {},
): CreateSessionRequest {
  return {
    idempotencyKey: "create-session",
    booking: {
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: sessionStartsAt,
      endAt: sessionEndsAt,
      totalCostCents: 1001,
    },
    totalSlots: 3,
    minimumHeadcount: 2,
    ...overrides,
  };
}

function setup() {
  const unitOfWork = new CreateSessionUnitOfWork([readyBookerUser(bookerId)]);
  const clock = { now: vi.fn(() => hoursBeforeSessionStart(48)) };
  let sequence = 0;
  const ids = {
    next: vi.fn(
      () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    ),
  };
  const createSession = new CreateSession({
    unitOfWork,
    clock,
    ids,
    holdingAccountId,
  });
  return { createSession, unitOfWork, clock, ids };
}
