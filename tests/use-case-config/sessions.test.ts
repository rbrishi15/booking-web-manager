import { createSessionHandler } from "@/use-case-config/sessions";
import { PayoutAccount, type UUID } from "@/domain";
import type {
  CreateSessionResult,
  SessionConfig,
} from "@/use-cases/sessions/CreateSessions";
import { describe, expect, test } from "vitest";
import {
  createTestUser,
  readyBookerUser,
} from "../domain/accounts/user-fixtures";
import {
  hoursBeforeSessionStart,
  sessionEndsAt,
  sessionStartsAt,
} from "../domain/sessions/session/session-fixtures";
import { CreateSessionUnitOfWork } from "../use-cases/support/create-session-unit-of-work";

const bookerId = "11111111-1111-4111-8111-111111111111";
const otherBookerId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const holdingAccountId = "00000000-0000-4000-8000-000000000001";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-02 session HTTP composition", () => {
  test("creates a private session and returns its persisted integer-cent share", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();

    // Act
    const response = await handler(postRequest(creationRequest()));
    const result: CreateSessionResult = await response.json();

    // Assert
    expect(response.status).toBe(201);
    expect(result).toEqual({
      sessionId: "50000000-0000-4000-8000-000000000001",
      roomToken: "50000000-0000-4000-8000-000000000002",
      bookingShareCents: 333,
    });
    const session = unitOfWork.requireSession(result.sessionId);
    expect(session.bookerId).toBe(bookerId);
    expect(session.booking.totalCost.toCents()).toBe(1001);
    expect(session.bookingShare.toCents()).toBe(result.bookingShareCents);
    expect(session.totalSlots).toBe(3);
    expect(session.minimumHeadcount).toBe(2);
    expect(session.roomToken).toBe(result.roomToken);
    expect(session.holdingAccountId).toBe(holdingAccountId);
    expect(session.visibility).toBe("PRIVATE");
    expect(session.minimumReliability).toBeUndefined();
    expect(session.invitedGroupId).toBeUndefined();
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.ledgerInstructions).toEqual([]);
    expect(unitOfWork.payoutRequests).toEqual([]);
  });

  test("maps optional configuration and timezone-bearing timestamps into the domain", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest({
      visibility: "PUBLIC",
      minimumReliability: 75,
      invitedGroupId: groupId,
    });
    request.booking.startAt = "2026-10-10T18:00:00+08:00";
    request.booking.endAt = "2026-10-10T20:00:00+08:00";

    // Act
    const response = await handler(postRequest(request));
    const result: CreateSessionResult = await response.json();

    // Assert
    expect(response.status).toBe(201);
    const session = unitOfWork.requireSession(result.sessionId);
    expect(session.booking).toMatchObject({
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: sessionStartsAt,
      endAt: sessionEndsAt,
    });
    expect(session.visibility).toBe("PUBLIC");
    expect(session.minimumReliability?.toNumber()).toBe(75);
    expect(session.invitedGroupId).toBe(groupId);
  });

  test("uses verified identity and computed share despite forged JSON fields", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest();
    const forgedRequest = {
      ...request,
      actorUserId: otherBookerId,
      bookerId: otherBookerId,
      bookingShareCents: 1,
      sessionId: otherBookerId,
      roomToken: "forged-room",
      holdingAccountId: otherBookerId,
      config: {
        ...request.config,
        bookerId: otherBookerId,
        bookingShareCents: 1,
      },
    };

    // Act
    const response = await handler(postRequest(forgedRequest));
    const result: CreateSessionResult = await response.json();

    // Assert
    expect(response.status).toBe(201);
    expect(result.bookingShareCents).toBe(333);
    expect(result.sessionId).not.toBe(otherBookerId);
    expect(result.roomToken).not.toBe("forged-room");
    const session = unitOfWork.requireSession(result.sessionId);
    expect(session.bookerId).toBe(bookerId);
    expect(session.bookingShare.toCents()).toBe(333);
    expect(session.holdingAccountId).toBe(holdingAccountId);
  });

  test("requires authentication even when the JSON body supplies a booker", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = { ...creationRequest(), bookerId };

    // Act
    const response = await handler(postRequest(request, null));

    // Assert
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects malformed JSON before creating a session", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer booker",
        "Content-Type": "application/json",
      },
      body: "{",
    });

    // Act
    const response = await handler(request);

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects a schema-invalid capacity without coercing numeric strings", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest();

    // Act
    const response = await handler(
      postRequest({
        ...request,
        config: { ...request.config, totalSlots: "3" },
      }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rejects a timestamp without a timezone", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest();
    request.booking.startAt = "2026-10-10T10:00:00";

    // Act
    const response = await handler(postRequest(request));

    // Assert
    expect(response.status).toBe(400);
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns forbidden for an inactive authenticated booker", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    unitOfWork.users.set(
      bookerId,
      createTestUser({ userId: bookerId, accountStatus: "INACTIVE" }),
    );

    // Act
    const response = await handler(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "INACTIVE_ACCOUNT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns not found when the authenticated user has no domain account", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    unitOfWork.users.clear();

    // Act
    const response = await handler(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns conflict when the booker's payout setup is incomplete", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    unitOfWork.users.set(
      bookerId,
      createTestUser({
        userId: bookerId,
        payoutAccount: PayoutAccount.create({
          payoutAccountId: "pending-payout-account",
          userId: bookerId,
          providerAccountReference: "provider",
        }),
      }),
    );

    // Act
    const response = await handler(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYOUT_ACCOUNT_NOT_READY" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns conflict when the server clock reaches session start", async () => {
    // Arrange
    const { handler, unitOfWork, setTime } = sessionHttpScenario();
    setTime(sessionStartsAt);

    // Act
    const response = await handler(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SESSION_STARTED" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("maps an invalid booking interval to an input error", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest();
    request.booking.endAt = request.booking.startAt;

    // Act
    const response = await handler(postRequest(request));

    // Assert
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("maps an out-of-range reliability choice to an input error", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest({ minimumReliability: 101 });

    // Act
    const response = await handler(postRequest(request));

    // Assert
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("preserves the domain capacity limit as an input error", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest({ totalSlots: 9 });

    // Act
    const response = await handler(postRequest(request));

    // Assert
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("replays the original result across handler instances with changed valid input", async () => {
    // Arrange
    const { handler, makeHandler, unitOfWork } = sessionHttpScenario();
    const firstResponse = await handler(postRequest(creationRequest()));
    const first: CreateSessionResult = await firstResponse.json();
    const retry = makeHandler();
    const changedRequest = creationRequest({ totalSlots: 2 });

    // Act
    const replayResponse = await retry(postRequest(changedRequest));

    // Assert
    expect(firstResponse.status).toBe(201);
    expect(replayResponse.status).toBe(201);
    expect(await replayResponse.json()).toEqual(first);
    expect(unitOfWork.sessions.size).toBe(1);
    expect(unitOfWork.requireSession(first.sessionId).totalSlots).toBe(3);
  });

  test("creates distinct sessions when HTTP submissions use different keys", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    const request = creationRequest();
    const firstResponse = await handler(postRequest(request));
    const first: CreateSessionResult = await firstResponse.json();

    // Act
    const secondResponse = await handler(
      postRequest({
        ...request,
        idempotencyKey: "second-submission",
      }),
    );
    const second: CreateSessionResult = await secondResponse.json();

    // Assert
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.roomToken).not.toBe(first.roomToken);
    expect(unitOfWork.sessions.size).toBe(2);
  });

  test("isolates the same submission key between independently authenticated bookers", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    unitOfWork.users.set(otherBookerId, readyBookerUser(otherBookerId));
    const firstResponse = await handler(postRequest(creationRequest()));
    const first: CreateSessionResult = await firstResponse.json();

    // Act
    const secondResponse = await handler(
      postRequest(creationRequest(), "Bearer other-booker"),
    );
    const second: CreateSessionResult = await secondResponse.json();

    // Assert
    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(unitOfWork.requireSession(first.sessionId).bookerId).toBe(bookerId);
    expect(unitOfWork.requireSession(second.sessionId).bookerId).toBe(
      otherBookerId,
    );
    expect(unitOfWork.sessions.size).toBe(2);
  });

  test("redacts authentication provider failures as server errors", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario(async () => {
      throw new Error("authentication-provider-secret");
    });

    // Act
    const response = await handler(postRequest(creationRequest()));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(JSON.stringify(body)).not.toContain(
      "authentication-provider-secret",
    );
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("treats a malformed verified identity as a server dependency error", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario(
      async () => "invalid-uuid",
    );

    // Act
    const response = await handler(postRequest(creationRequest()));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(JSON.stringify(body)).not.toContain("invalid-uuid");
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("keeps a hydration RangeError separate from invalid client input", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    unitOfWork.nextUserLoadError = new RangeError(
      "private-corrupt-user-record",
    );

    // Act
    const response = await handler(postRequest(creationRequest()));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(JSON.stringify(body)).not.toContain("private-corrupt-user-record");
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("rolls back a save RangeError and allows the same HTTP submission to retry", async () => {
    // Arrange
    const { handler, makeHandler, unitOfWork } = sessionHttpScenario();
    unitOfWork.nextSaveError = new RangeError("private-database-range-error");
    const request = creationRequest();

    // Act
    const failure = await handler(postRequest(request));
    const failureBody = await failure.json();

    // Assert
    expect(failure.status).toBe(500);
    expect(failureBody).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(JSON.stringify(failureBody)).not.toContain(
      "private-database-range-error",
    );
    expect(unitOfWork.sessions.size).toBe(0);

    // Act
    const retry = await makeHandler()(postRequest(request));
    const result: CreateSessionResult = await retry.json();

    // Assert
    expect(retry.status).toBe(201);
    expect(result.bookingShareCents).toBe(333);
    expect(
      unitOfWork.requireSession(result.sessionId).bookingShare.toCents(),
    ).toBe(333);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("redacts an unexpected persistence failure and saves nothing", async () => {
    // Arrange
    const { handler, unitOfWork } = sessionHttpScenario();
    unitOfWork.nextSaveError = new Error("postgres-connection-secret");

    // Act
    const response = await handler(postRequest(creationRequest()));
    const body = await response.json();

    // Assert
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(JSON.stringify(body)).not.toContain("postgres-connection-secret");
    expect(unitOfWork.sessions.size).toBe(0);
    expect(unitOfWork.ledgerInstructions).toEqual([]);
    expect(unitOfWork.payoutRequests).toEqual([]);
  });
});

function creationRequest(config: Partial<SessionConfig> = {}) {
  return {
    idempotencyKey: "http-session-submission",
    booking: {
      venueName: "Jurong East Sports Hall",
      region: "West",
      sport: "Badminton",
      startAt: sessionStartsAt.toISOString(),
      endAt: sessionEndsAt.toISOString(),
      totalCostCents: 1001,
    },
    config: { totalSlots: 3, minimumHeadcount: 2, ...config },
  };
}

function postRequest(
  body: unknown,
  authorization: string | null = "Bearer booker",
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request("http://localhost/api/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function verifiedTestUser(request: Request): Promise<UUID | null> {
  if (request.headers.get("Authorization") === "Bearer booker") return bookerId;
  if (request.headers.get("Authorization") === "Bearer other-booker")
    return otherBookerId;
  return null;
}

function sessionHttpScenario(
  authenticate: (request: Request) => Promise<UUID | null> = verifiedTestUser,
) {
  const unitOfWork = new CreateSessionUnitOfWork([readyBookerUser(bookerId)]);
  let now = hoursBeforeSessionStart(48);
  let sequence = 0;
  const dependencies = {
    authenticate,
    unitOfWork,
    clock: { now: () => new Date(now) },
    ids: {
      next: () =>
        `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    },
    holdingAccountId,
  };
  const makeHandler = () => createSessionHandler(dependencies);
  return {
    handler: makeHandler(),
    makeHandler,
    unitOfWork,
    setTime: (at: Date) => {
      now = at;
    },
  };
}
