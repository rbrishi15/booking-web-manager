import type { SessionApiDependencies } from "@/app/sessions/dependencies";
import type { UUID } from "@/domain";
import type {
  CreateSessionResult,
  SessionConfig,
} from "@/use-cases/sessions/CreateSessions";
import { beforeEach, describe, expect, test, vi } from "vitest";

const configuration = vi.hoisted(() => ({
  createSessionDependencies: vi.fn<() => SessionApiDependencies>(),
}));

vi.mock("@/use-case-config/sessions", () => configuration);

beforeEach(() => {
  vi.resetModules();
  configuration.createSessionDependencies.mockReset();
});

const sessionStartsAt = new Date("2026-10-10T10:00:00Z");
const sessionEndsAt = new Date("2026-10-10T12:00:00Z");
const bookerId = "11111111-1111-4111-8111-111111111111";
const otherBookerId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const holdingAccountId = "00000000-0000-4000-8000-000000000001";

// Owner: Neoh (liang799) — /app/sessions
describe("UC2-02 POST /api/sessions", () => {
  test("creates a private session and returns its persisted integer-cent share", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();

    // Act
    const response = await POST(postRequest(creationRequest()));
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
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = creationRequest({
      visibility: "PUBLIC",
      minimumReliability: 75,
      invitedGroupId: groupId,
    });
    request.booking.startAt = "2026-10-10T18:00:00+08:00";
    request.booking.endAt = "2026-10-10T20:00:00+08:00";

    // Act
    const response = await POST(postRequest(request));
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
    const { POST, unitOfWork } = await sessionRouteScenario();
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
    const response = await POST(postRequest(forgedRequest));
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
    const { POST, unitOfWork, createForSubmission } = await sessionRouteScenario();
    const request = { ...creationRequest(), bookerId };

    // Act
    const response = await POST(postRequest(request, null));

    // Assert
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(unitOfWork.sessions.size).toBe(0);
    expect(createForSubmission).not.toHaveBeenCalled();
  });

  test("rejects malformed JSON and keeps initialized dependencies for a valid request", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: {
        Authorization: "Bearer booker",
        "Content-Type": "application/json",
      },
      body: "{",
    });

    // Act
    const response = await POST(request);

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
    expect(unitOfWork.sessions.size).toBe(0);

    // Act
    const recovered = await POST(postRequest(creationRequest()));
    const result: CreateSessionResult = await recovered.json();

    // Assert
    expect(recovered.status).toBe(201);
    expect(unitOfWork.requireSession(result.sessionId).bookerId).toBe(bookerId);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("rejects a schema-invalid capacity without coercing numeric strings", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = creationRequest();

    // Act
    const response = await POST(
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
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = creationRequest();
    request.booking.startAt = "2026-10-10T10:00:00";

    // Act
    const response = await POST(postRequest(request));

    // Assert
    expect(response.status).toBe(400);
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns forbidden for an inactive authenticated booker", async () => {
    // Arrange
    const { POST, unitOfWork, createTestUser } = await sessionRouteScenario();
    unitOfWork.users.set(
      bookerId,
      createTestUser({ userId: bookerId, accountStatus: "INACTIVE" }),
    );

    // Act
    const response = await POST(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "INACTIVE_ACCOUNT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns not found when the authenticated user has no domain account", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    unitOfWork.users.clear();

    // Act
    const response = await POST(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns conflict when the booker's payout setup is incomplete", async () => {
    // Arrange
    const { POST, unitOfWork, createTestUser, PayoutAccount } = await sessionRouteScenario();
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
    const response = await POST(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "PAYOUT_ACCOUNT_NOT_READY" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("returns conflict when the server clock reaches session start", async () => {
    // Arrange
    const { POST, unitOfWork, setTime } = await sessionRouteScenario();
    setTime(sessionStartsAt);

    // Act
    const response = await POST(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SESSION_STARTED" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("maps an invalid booking interval to an input error", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = creationRequest();
    request.booking.endAt = request.booking.startAt;

    // Act
    const response = await POST(postRequest(request));

    // Assert
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("maps an out-of-range reliability choice to an input error", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = creationRequest({ minimumReliability: 101 });

    // Act
    const response = await POST(postRequest(request));

    // Assert
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("preserves the domain capacity limit as an input error", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = creationRequest({ totalSlots: 9 });

    // Act
    const response = await POST(postRequest(request));

    // Assert
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("replays the original result across independently initialized routes with changed valid input", async () => {
    // Arrange
    const { POST, loadRoute, unitOfWork } = await sessionRouteScenario();
    const firstResponse = await POST(postRequest(creationRequest()));
    const first: CreateSessionResult = await firstResponse.json();
    const { POST: retry, readyBookerUser: reloadedBooker } = await loadRoute();
    // A fresh process hydrates persisted Users with its own domain constructors.
    unitOfWork.users.set(bookerId, reloadedBooker(bookerId));
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

  test("checks current account authorization before returning a successful replay", async () => {
    // Arrange
    const authenticate = vi.fn(verifiedTestUser);
    const { POST, unitOfWork, createForSubmission } = await sessionRouteScenario(authenticate);
    const firstResponse = await POST(postRequest(creationRequest()));
    const first: CreateSessionResult = await firstResponse.json();
    const { DomainError } = await import("@/domain");
    authenticate.mockRejectedValueOnce(new DomainError("INACTIVE_ACCOUNT", "Account is inactive"));

    // Act
    const denied = await POST(postRequest(creationRequest()));

    // Assert
    expect(firstResponse.status).toBe(201);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: { code: "INACTIVE_ACCOUNT", message: "Account is inactive" },
    });
    expect(authenticate).toHaveBeenCalledTimes(2);
    expect(createForSubmission).toHaveBeenCalledOnce();
    expect(unitOfWork.sessions.size).toBe(1);

    // Act: access is restored, while creation-specific booking eligibility has changed.
    const changedRequest = creationRequest({ totalSlots: 2 });
    changedRequest.booking.startAt = "2020-01-01T10:00:00Z";
    changedRequest.booking.endAt = "2020-01-01T12:00:00Z";
    const replay = await POST(postRequest(changedRequest));

    // Assert
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(first);
    expect(authenticate).toHaveBeenCalledTimes(3);
    expect(createForSubmission).toHaveBeenCalledTimes(2);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("maps an intentionally unavailable creation capability to the fixed 503 response", async () => {
    // Arrange
    const { POST, unitOfWork, createForSubmission } = await sessionRouteScenario();
    const { SessionApiUnavailableError } = await import("@/app/sessions/session-api-unavailable");
    const unavailable = new SessionApiUnavailableError();
    unavailable.message = "private-integration-detail";
    createForSubmission.mockImplementationOnce(() => { throw unavailable; });

    // Act
    const response = await POST(postRequest(creationRequest()));

    // Assert
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "SESSION_API_UNAVAILABLE",
        message: "Session creation is not available yet",
      },
    });
    expect(unitOfWork.sessions.size).toBe(0);
  });

  test("creates distinct sessions when HTTP submissions use different keys", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    const request = creationRequest();
    const firstResponse = await POST(postRequest(request));
    const first: CreateSessionResult = await firstResponse.json();

    // Act
    const secondResponse = await POST(
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
    const { POST, unitOfWork, readyBookerUser } = await sessionRouteScenario();
    unitOfWork.users.set(otherBookerId, readyBookerUser(otherBookerId));
    const firstResponse = await POST(postRequest(creationRequest()));
    const first: CreateSessionResult = await firstResponse.json();

    // Act
    const secondResponse = await POST(
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

  test.each(["Error", "DomainError", "SessionApiUnavailableError"])(
    "redacts dependency assembly %s and retries setup on the next request",
    async (errorType) => {
      // Arrange
      const authenticate = vi.fn(verifiedTestUser);
      const { POST, unitOfWork } = await sessionRouteScenario(authenticate);
      const { DomainError } = await import("@/domain");
      const { SessionApiUnavailableError } = await import("@/app/sessions/session-api-unavailable");
      const failure = errorType === "DomainError"
        ? new DomainError("INACTIVE_ACCOUNT", "private-dependency-setup-failure")
        : errorType === "SessionApiUnavailableError"
          ? new SessionApiUnavailableError()
          : new Error("private-dependency-setup-failure");
      configuration.createSessionDependencies.mockImplementationOnce(() => {
        throw failure;
      });

      // Act
      const response = await POST(postRequest(creationRequest()));

      // Assert
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
      expect(authenticate).not.toHaveBeenCalled();
      expect(unitOfWork.sessions.size).toBe(0);

      // Act
      const recovered = await POST(postRequest(creationRequest()));

      // Assert
      expect(recovered.status).toBe(201);
      expect(configuration.createSessionDependencies).toHaveBeenCalledTimes(2);
      expect(authenticate).toHaveBeenCalledOnce();
      expect(unitOfWork.sessions.size).toBe(1);
    },
  );

  test("redacts authentication failures and keeps initialized dependencies for retry", async () => {
    // Arrange
    let providerAvailable = false;
    const { POST, unitOfWork } = await sessionRouteScenario(async (request) => {
      if (!providerAvailable) throw new Error("authentication-provider-secret");
      return verifiedTestUser(request);
    });

    // Act
    const response = await POST(postRequest(creationRequest()));
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

    // Act
    providerAvailable = true;
    const recovered = await POST(postRequest(creationRequest()));
    const result: CreateSessionResult = await recovered.json();

    // Assert
    expect(recovered.status).toBe(201);
    expect(unitOfWork.requireSession(result.sessionId).bookerId).toBe(bookerId);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("treats a malformed verified identity as a server dependency error", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario(
      async () => "invalid-uuid",
    );

    // Act
    const response = await POST(postRequest(creationRequest()));
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
    const { POST, unitOfWork } = await sessionRouteScenario();
    unitOfWork.nextUserLoadError = new RangeError(
      "private-corrupt-user-record",
    );

    // Act
    const response = await POST(postRequest(creationRequest()));
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
    const { POST, loadRoute, unitOfWork } = await sessionRouteScenario();
    unitOfWork.nextSaveError = new RangeError("private-database-range-error");
    const request = creationRequest();

    // Act
    const failure = await POST(postRequest(request));
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
    const { POST: retryPost, readyBookerUser: reloadedBooker } = await loadRoute();
    // A fresh process hydrates persisted Users with its own domain constructors.
    unitOfWork.users.set(bookerId, reloadedBooker(bookerId));
    const retry = await retryPost(postRequest(request));
    const result: CreateSessionResult = await retry.json();

    // Assert
    expect(retry.status).toBe(201);
    expect(result.bookingShareCents).toBe(333);
    expect(
      unitOfWork.requireSession(result.sessionId).bookingShare.toCents(),
    ).toBe(333);
    expect(unitOfWork.sessions.size).toBe(1);
  });

  test("redacts persistence failures and keeps initialized dependencies for retry", async () => {
    // Arrange
    const { POST, unitOfWork } = await sessionRouteScenario();
    unitOfWork.nextSaveError = new Error("postgres-connection-secret");

    // Act
    const response = await POST(postRequest(creationRequest()));
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

    // Act
    const recovered = await POST(postRequest(creationRequest()));
    const result: CreateSessionResult = await recovered.json();

    // Assert
    expect(recovered.status).toBe(201);
    expect(unitOfWork.requireSession(result.sessionId).bookerId).toBe(bookerId);
    expect(unitOfWork.sessions.size).toBe(1);
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

async function sessionRouteScenario(
  authenticate: (request: Request) => Promise<UUID | null> = verifiedTestUser,
) {
  // Load real domain fixtures after resetModules so error classes match the route.
  const { PayoutAccount } = await import("@/domain");
  const { createTestUser, readyBookerUser } = await import(
    "../../domain/accounts/user-fixtures"
  );
  const { CreateSessionUnitOfWork } = await import(
    "../../use-cases/support/create-session-unit-of-work"
  );
  const unitOfWork = new CreateSessionUnitOfWork([readyBookerUser(bookerId)]);
  const createForSubmission = vi.fn<SessionApiDependencies["createForSubmission"]>();
  let now = new Date("2026-10-08T10:00:00Z");
  let sequence = 0;
  let routeLoaded = false;
  const clock = { now: () => new Date(now) };
  const ids = {
    next: () =>
      `50000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  };
  const loadRoute = async () => {
    if (routeLoaded) vi.resetModules();
    const { CreateSessions } = await import("@/use-cases/sessions/CreateSessions");
    const { RequestSessionCreationTransaction } = await import(
      "@/lib/sessions/request-session-creation-transaction"
    );
    createForSubmission.mockImplementation((submission) =>
      new CreateSessions({
        transaction: new RequestSessionCreationTransaction(unitOfWork, submission),
        clock,
        ids,
        holdingAccountId,
      }),
    );
    configuration.createSessionDependencies.mockReturnValue({ authenticate, createForSubmission });
    const route = await import("@/app/api/sessions/route");
    const { readyBookerUser } = await import("../../domain/accounts/user-fixtures");
    routeLoaded = true;
    return { ...route, readyBookerUser };
  };
  const { POST } = await loadRoute();
  return {
    POST,
    loadRoute,
    unitOfWork,
    createForSubmission,
    createTestUser,
    readyBookerUser,
    PayoutAccount,
    setTime: (at: Date) => {
      now = at;
    },
  };
}
