import { parseCreateSessionInput } from "@/app/sessions/create-session-input";
import { RequestSessionCreationTransaction } from "@/app/sessions/request-session-creation-transaction";
import { PayoutAccount } from "@/domain";
import {
  CreateSessions,
  type CreateSessionInput,
  type SessionConfig,
} from "@/use-cases/sessions/CreateSessions";
import { describe, expect, test } from "vitest";
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
      const { createSessions, unitOfWork } = sessionCreationScenario();
      const request = {
        ...creationInput(),
        bookingShareCents: 1,
        bookingShare: 1,
        share: 1,
      };

      // Act
      const result = await createSessions.forBooker(request);

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
      const { createSessions, unitOfWork } = sessionCreationScenario();
      const input: CreateSessionInput = {
        bookerId,
        booking: {
          venueName: "Jurong East Sports Hall",
          region: "West",
          sport: "Badminton",
          startAt: sessionStartsAt,
          endAt: sessionEndsAt,
          totalCostCents: 1001,
        },
        config: { totalSlots: 3, minimumHeadcount: 2 },
      };

      // Act
      const result = await createSessions.forBooker(input);

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
    const { createSessions, unitOfWork } = sessionCreationScenario();
    const request = creationInput({
      visibility: "PUBLIC",
      minimumReliability: 75,
      invitedGroupId: groupId,
    });

    // Act
    const result = await createSessions.forBooker(request);

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
    const { createSessions, unitOfWork } = sessionCreationScenario();
    const request = {
      ...creationInput(),
      sessionId: otherBookerId,
      roomToken: "client-token",
      holdingAccountId: otherBookerId,
      actorUserId: otherBookerId,
      status: "SETTLED",
      participations: [{ userId: otherBookerId }],
    };

    // Act
    const result = await createSessions.forBooker(request);

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
  });

  test("rejects a missing booker without persisting a session", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
    unitOfWork.users.clear();

    // Act & Assert
    await expect(
      createSessions.forBooker(creationInput()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects an inactive booker despite a client-supplied active status", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
    unitOfWork.users.set(
      bookerId,
      createTestUser({ userId: bookerId, accountStatus: "INACTIVE" }),
    );
    const request = { ...creationInput(), accountStatus: "ACTIVE" };

    // Act & Assert
    await expect(createSessions.forBooker(request)).rejects.toMatchObject({
      code: "INACTIVE_ACCOUNT",
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects incomplete payout setup despite client-supplied readiness", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
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
      ...creationInput(),
      payoutAccount: { setupStatus: "COMPLETE" },
    };

    // Act & Assert
    await expect(createSessions.forBooker(request)).rejects.toMatchObject({
      code: "PAYOUT_ACCOUNT_NOT_READY",
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("uses the server clock to reject a session that has just started", async () => {
    // Arrange
    const { createSessions, unitOfWork, setTime } = sessionCreationScenario();
    setTime(sessionStartsAt);
    const request = { ...creationInput(), now: hoursBeforeSessionStart(48) };

    // Act & Assert
    await expect(createSessions.forBooker(request)).rejects.toMatchObject({
      code: "SESSION_STARTED",
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects an invalid booking interval without persisting a session", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
    const request = creationInput();
    request.booking.endAt = sessionStartsAt;

    // Act & Assert
    await expect(createSessions.forBooker(request)).rejects.toThrow(
      "Booking endAt must be after startAt",
    );
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects a blank venue without persisting a session", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
    const request = creationInput();
    request.booking.venueName = " ";

    // Act & Assert
    await expect(createSessions.forBooker(request)).rejects.toThrow(
      "Booking venue, region, and sport are required",
    );
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects zero booking cost without persisting a session", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
    const request = creationInput();
    request.booking.totalCostCents = 0;

    // Act & Assert
    await expect(createSessions.forBooker(request)).rejects.toThrow(
      "Booking totalCost must be positive",
    );
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects capacity beyond the domain limit without persisting a session", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();

    // Act & Assert
    await expect(
      createSessions.forBooker(creationInput({ totalSlots: 9 })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects minimum headcount greater than capacity", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();

    // Act & Assert
    await expect(
      createSessions.forBooker(creationInput({ minimumHeadcount: 4 })),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects a positive cost that produces a zero-cent share", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
    const request = creationInput();
    request.booking.totalCostCents = 2;

    // Act & Assert
    await expect(createSessions.forBooker(request)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("replays a submission through independently constructed use cases", async () => {
    // Arrange
    const { forSubmission, unitOfWork } = sessionCreationScenario();
    const firstAttempt = forSubmission("same-submission");
    const retry = forSubmission("same-submission");
    const input = creationInput();

    // Act
    const first = await firstAttempt.forBooker(input);
    const replay = await retry.forBooker(input);

    // Assert
    expect(replay).toEqual(first);
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.requireSession(first.sessionId).bookerId).toBe(bookerId);
  });

  test("a retried submission returns the original result after the session starts", async () => {
    // Arrange
    const { forSubmission, unitOfWork, setTime } = sessionCreationScenario();
    const first = await forSubmission("same-submission").forBooker(creationInput());
    setTime(sessionStartsAt);

    // Act
    const replay = await forSubmission("same-submission").forBooker(creationInput());

    // Assert
    expect(replay).toEqual(first);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("a retried submission with changed configuration returns the original creation", async () => {
    // Arrange
    const { forSubmission, unitOfWork } = sessionCreationScenario();
    const first = await forSubmission("same-submission").forBooker(creationInput());
    const changedInput = creationInput({ totalSlots: 2 });

    // Act
    const replay = await forSubmission("same-submission").forBooker(changedInput);

    // Assert
    expect(replay).toEqual(first);
    expect(replay.bookingShareCents).toBe(333);
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.requireSession(first.sessionId).totalSlots).toBe(3);
  });

  test("creates distinct sessions for different submissions with identical details", async () => {
    // Arrange
    const { forSubmission, unitOfWork } = sessionCreationScenario();
    const input = creationInput();
    const first = await forSubmission("first-submission").forBooker(input);

    // Act
    const second = await forSubmission("second-submission").forBooker(input);

    // Assert
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.roomToken).not.toBe(first.roomToken);
    expect(second.bookingShareCents).toBe(first.bookingShareCents);
    expect(unitOfWork.sessions.size).toBe(2);
  });

  test("isolates the same submission identity between different bookers", async () => {
    // Arrange
    const { forSubmission, unitOfWork } = sessionCreationScenario();
    unitOfWork.users.set(otherBookerId, readyBookerUser(otherBookerId));
    const first = await forSubmission("same-submission").forBooker(creationInput());

    // Act
    const second = await forSubmission("same-submission").forBooker({
      ...creationInput(),
      bookerId: otherBookerId,
    });

    // Assert
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(unitOfWork.requireSession(first.sessionId).bookerId).toBe(bookerId);
    expect(unitOfWork.requireSession(second.sessionId).bookerId).toBe(otherBookerId);
    expect(unitOfWork.sessions.size).toBe(2);
  });

  test("uses the authenticated booker when the submitted body supplies another identity", async () => {
    // Arrange
    const { forSubmission, unitOfWork } = sessionCreationScenario();
    const parsed = parseCreateSessionInput(bookerId, {
      ...creationInput(),
      bookerId: otherBookerId,
      idempotencyKey: "authenticated-submission",
    });
    const createSessions = forSubmission(parsed.submission.idempotencyKey);

    // Act
    const created = await createSessions.forBooker(parsed.input);

    // Assert
    expect(unitOfWork.requireSession(created.sessionId).bookerId).toBe(bookerId);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("a failed save leaves no committed session", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();
    unitOfWork.failNextSave = true;

    // Act & Assert
    await expect(
      createSessions.forBooker(creationInput()),
    ).rejects.toThrow("Session save failed");
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("a failed save can be retried through a new use-case instance", async () => {
    // Arrange
    const { forSubmission, unitOfWork } = sessionCreationScenario();
    const input = creationInput();
    unitOfWork.failNextSave = true;
    await expect(
      forSubmission("retried-submission").forBooker(input),
    ).rejects.toThrow("Session save failed");

    // Act
    const created = await forSubmission("retried-submission").forBooker(input);

    // Assert
    expect(unitOfWork.requireSession(created.sessionId).bookingShare.toCents()).toBe(
      333,
    );
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("creates a session without moving funds or requesting a payout", async () => {
    // Arrange
    const { createSessions, unitOfWork } = sessionCreationScenario();

    // Act
    await createSessions.forBooker(creationInput());

    // Assert
    expect(unitOfWork.ledgerInstructions).toEqual([]);
    expect(unitOfWork.payoutRequests).toEqual([]);
  });
});

function creationInput(config: Partial<SessionConfig> = {}): CreateSessionInput {
  return {
    bookerId,
    booking: {
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: sessionStartsAt,
      endAt: sessionEndsAt,
      totalCostCents: 1001,
    },
    config: { totalSlots: 3, minimumHeadcount: 2, ...config },
  };
}

function sessionCreationScenario() {
  const unitOfWork = new CreateSessionUnitOfWork([readyBookerUser(bookerId)]);
  let now = hoursBeforeSessionStart(48);
  const clock = { now: () => new Date(now) };
  let sequence = 0;
  const ids = {
    next: () => `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  };
  const forSubmission = (idempotencyKey: string) =>
    new CreateSessions({
      transaction: new RequestSessionCreationTransaction(unitOfWork, {
        idempotencyKey,
      }),
      clock,
      ids,
      holdingAccountId,
    });
  return {
    createSessions: forSubmission("initial-submission"),
    forSubmission,
    unitOfWork,
    setTime: (at: Date) => {
      now = at;
    },
  };
}
