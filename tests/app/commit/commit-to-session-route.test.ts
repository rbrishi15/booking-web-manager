import { describe, expect, test, vi } from "vitest";

const getDependencies = vi.hoisted(() => vi.fn());
vi.mock("@/app/commit/commitment-server-dependencies", () => ({
  getCommitmentDependencies: getDependencies,
}));
import { POST as commit } from "@/app/api/sessions/commit/route";
import { Session, type UUID } from "@/domain";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { commitmentDependencies } from "./commitment-test-dependencies";
import { createTestUserDetails } from "../../domain/accounts/user-fixtures";
import {
  hoursBeforeSessionStart,
  sessionDetails,
} from "../../domain/sessions/session/session-fixtures";
import { InMemoryUnitOfWork } from "../../use-cases/support/in-memory-unit-of-work";

const aliceId = "11111111-1111-4111-8111-111111111111";
const bobId = "22222222-2222-4222-8222-222222222222";
const publicSessionId = "33333333-3333-4333-8333-333333333333";
const privateSessionId = "44444444-4444-4444-8444-444444444444";
const missingSessionId = "55555555-5555-4555-8555-555555555555";

describe("POST /api/sessions/commit", () => {
  test("commitRoute_WhenAuthenticated_CommitsForTheSignedInUserOnly", async () => {
    // Arrange
    const { handle, unitOfWork } = handlerScenario();
    const body = {
      ...commitBody(),
      userId: bobId,
      amountCents: 1,
      heldCents: 1,
    };

    // Act
    const response = await handle(jsonRequest(body));

    // Assert
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      kind: "COMMITTED",
      sessionId: publicSessionId,
      heldCents: 500,
    });
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
    expect(unitOfWork.ledgerInstructions[0]?.walletId).toBe(`w-${aliceId}`);
    expect(unitOfWork.ledgerInstructions[0]?.amount.toCents()).toBe(500);
    expect(unitOfWork.availableCents(bobId)).toBe(10_000);
  });

  test("commitRoute_WhenRetriedWithSameKey_ReturnsOriginalResponseWithoutLockingAgain", async () => {
    // Arrange
    const { handle, unitOfWork } = handlerScenario();
    const first = await handle(jsonRequest(commitBody()));

    // Act
    const retry = await handle(jsonRequest(commitBody()));

    // Assert
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual(await first.json());
    expect(unitOfWork.ledgerInstructions).toHaveLength(1);
  });

  test("commitRoute_WhenSignedOut_Returns401WithoutWriting", async () => {
    // Arrange
    const { handle, unitOfWork } = handlerScenario({ actor: null });

    // Act
    const response = await handle(jsonRequest(commitBody()));

    // Assert
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
      },
    });
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("commitRoute_WhenAuthenticationFails_Returns500WithoutDetails", async () => {
    // Arrange
    const { handle } = handlerScenario({
      authenticate: async () => {
        throw new Error("auth provider unavailable");
      },
    });

    // Act
    const response = await handle(jsonRequest(commitBody()));

    // Assert
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  test("commitRoute_WhenBodyIsNotJson_Returns400", async () => {
    // Arrange
    const { handle } = handlerScenario();

    // Act
    const response = await handle(
      new Request("http://localhost/commit", { method: "POST", body: "{" }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  test("commitRoute_WhenIdempotencyKeyIsMissing_Returns400WithoutWriting", async () => {
    // Arrange
    const { handle, unitOfWork } = handlerScenario();

    // Act
    const response = await handle(
      jsonRequest({ sessionId: publicSessionId, idempotencyKey: " " }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("commitRoute_WhenSessionIdIsNotUuid_Returns400", async () => {
    // Arrange
    const { handle } = handlerScenario();

    // Act
    const response = await handle(
      jsonRequest({ ...commitBody(), sessionId: "not-a-uuid" }),
    );

    // Assert
    expect(response.status).toBe(400);
  });

  test("commitRoute_WhenFundsAreInsufficient_Returns409", async () => {
    // Arrange
    const { handle, unitOfWork } = handlerScenario({ aliceFundsCents: 499 });

    // Act
    const response = await handle(jsonRequest(commitBody()));

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "INSUFFICIENT_FUNDS" },
    });
    expect(unitOfWork.ledgerInstructions).toHaveLength(0);
  });

  test("commitRoute_WhenPrivateSessionHasNoToken_Returns403", async () => {
    // Arrange
    const { handle } = handlerScenario();

    // Act
    const response = await handle(
      jsonRequest({ ...commitBody(), sessionId: privateSessionId }),
    );

    // Assert
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ACCESS" },
    });
  });

  test("commitRoute_WhenPrivateSessionHasToken_Returns201", async () => {
    // Arrange
    const { handle } = handlerScenario();

    // Act
    const response = await handle(
      jsonRequest({
        ...commitBody(),
        sessionId: privateSessionId,
        roomToken: "room",
      }),
    );

    // Assert
    expect(response.status).toBe(201);
  });

  test("commitRoute_WhenSessionDoesNotExist_Returns404", async () => {
    // Arrange
    const { handle } = handlerScenario();

    // Act
    const response = await handle(
      jsonRequest({ ...commitBody(), sessionId: missingSessionId }),
    );

    // Assert
    expect(response.status).toBe(404);
  });

  test("commitRoute_WhenUseCaseFailsUnexpectedly_Returns500WithoutDetails", async () => {
    // Arrange
    const { handle, unitOfWork } = handlerScenario();
    unitOfWork.failNextLedgerAppend = true;

    // Act
    const response = await handle(jsonRequest(commitBody()));

    // Assert
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});

function handlerScenario(
  options: {
    actor?: UUID | null;
    authenticate?: (request: Request) => Promise<UUID | null>;
    aliceFundsCents?: number;
  } = {},
) {
  const unitOfWork = new InMemoryUnitOfWork({
    users: [
      createTestUserDetails({
        userId: aliceId,
        availableFundsCents: options.aliceFundsCents ?? 10_000,
      }),
      createTestUserDetails({ userId: bobId }),
    ],
    sessions: [
      new Session(sessionDetails({ sessionId: publicSessionId })),
      new Session(
        sessionDetails({ sessionId: privateSessionId, visibility: "PRIVATE" }),
      ),
    ],
  });
  let nextId = 0;
  const commitToSession = new CommitToSession({
    unitOfWork,
    clock: { now: () => hoursBeforeSessionStart(48) },
    ids: {
      next: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
    },
  });
  const actor = options.actor === undefined ? aliceId : options.actor;
  const authenticate = options.authenticate ?? (async () => actor);
  const handle = (request: Request) => {
    getDependencies.mockResolvedValue(
      commitmentDependencies({ authenticate, commitToSession }),
    );
    return commit(request);
  };
  return { handle, unitOfWork };
}

function commitBody() {
  return { sessionId: publicSessionId, idempotencyKey: "commit-1" };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
