import { handleVerifyAttendance } from "@/app/commit/verify-attendance-handler";
import {
  handleAcceptReplacement,
  handleLeaveWaitlist,
  handleWithdrawFromSession,
} from "@/app/commit/withdrawal-handlers";
import { Session, type UUID } from "@/domain";
import { AcceptReplacement } from "@/use-cases/sessions/AcceptReplacement";
import { CommitToSession } from "@/use-cases/sessions/CommitToSession";
import { LeaveWaitlist } from "@/use-cases/sessions/LeaveWaitlist";
import { PromoteFromWaitlist } from "@/use-cases/sessions/PromoteFromWaitlist";
import { VerifyAttendance } from "@/use-cases/sessions/VerifyAttendance";
import { WithdrawFromSession } from "@/use-cases/sessions/WithdrawFromSession";
import { describe, expect, test } from "vitest";
import {
  createTestUserDetails,
  readyBookerUser,
} from "../../domain/accounts/user-fixtures";
import {
  hoursAfterSessionEnd,
  hoursBeforeSessionStart,
  sessionDetails,
} from "../../domain/sessions/session/session-fixtures";
import { InMemoryUnitOfWork } from "../../use-cases/support/in-memory-unit-of-work";
import { RecordingNotifier } from "../../use-cases/support/recording-notifier";

const bookerId = "10000000-0000-4000-8000-000000000000";
const aliceId = "11111111-1111-4111-8111-111111111111";
const bobId = "22222222-2222-4222-8222-222222222222";
const carolId = "33333333-3333-4333-8333-333333333333";
const daveId = "44444444-4444-4444-8444-444444444444";
const sessionId = "55555555-5555-4555-8555-555555555555";

describe("handleWithdrawFromSession", () => {
  test("handleWithdrawFromSession_WhenEarly_RefundsTheSignedInParticipant", async () => {
    // Arrange
    const scenario = await handlerScenario();
    scenario.setTime(hoursBeforeSessionStart(31));

    // Act
    const response = await scenario.withdraw(
      aliceId,
      withdrawBody({ userId: bobId, refundedCents: 1_000_000 }),
    );

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "REFUNDED",
      refundedCents: 500,
      promotion: { status: "COMPLETED" },
    });
    expect(scenario.unitOfWork.availableCents(aliceId)).toBe(10_000);
    expect(scenario.unitOfWork.availableCents(bobId)).toBe(9_500);
  });

  test("handleWithdrawFromSession_WhenReplacementModeIsUnknown_Returns400", async () => {
    // Arrange
    const scenario = await handlerScenario();

    // Act
    const response = await scenario.withdraw(
      aliceId,
      withdrawBody({ replacement: { mode: "OFFER_TO_WAITLIST" } }),
    );

    // Assert
    expect(response.status).toBe(400);
    expect(scenario.participantStatus(aliceId)).toBe("COMMITTED");
  });

  test("handleWithdrawFromSession_WhenDirectInviteHasNoInvitee_Returns400", async () => {
    // Arrange
    const scenario = await handlerScenario();

    // Act
    const response = await scenario.withdraw(
      aliceId,
      withdrawBody({ replacement: { mode: "DIRECT_INVITE" } }),
    );

    // Assert
    expect(response.status).toBe(400);
  });

  test("handleWithdrawFromSession_WhenUserIsNotParticipating_Returns404", async () => {
    // Arrange
    const scenario = await handlerScenario();

    // Act
    const response = await scenario.withdraw(daveId, withdrawBody());

    // Assert
    expect(response.status).toBe(404);
  });
});

describe("handleAcceptReplacement", () => {
  test("handleAcceptReplacement_WhenInvited_Returns201AndRefundsTheWithdrawer", async () => {
    // Arrange
    const scenario = await handlerScenario();
    scenario.setTime(hoursBeforeSessionStart(10));
    await scenario.withdraw(
      aliceId,
      withdrawBody({ replacement: { mode: "DIRECT_INVITE", inviteeId: daveId } }),
    );

    // Act
    const response = await scenario.accept(daveId);

    // Assert
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ heldCents: 500 });
    expect(scenario.unitOfWork.availableCents(aliceId)).toBe(10_000);
    expect(scenario.unitOfWork.availableCents(daveId)).toBe(9_500);
  });

  test("handleAcceptReplacement_WhenNotInvited_Returns403", async () => {
    // Arrange
    const scenario = await handlerScenario();

    // Act
    const response = await scenario.accept(daveId);

    // Assert
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_ACCESS" },
    });
  });
});

describe("handleLeaveWaitlist", () => {
  test("handleLeaveWaitlist_WhenWaitlisted_Returns200", async () => {
    // Arrange
    const scenario = await handlerScenario();

    // Act
    const response = await scenario.leave(carolId);

    // Assert
    expect(response.status).toBe(200);
    expect(scenario.participantStatus(carolId)).toBe("LEFT_WAITLIST");
  });

  test("handleLeaveWaitlist_WhenCommittedInstead_Returns409", async () => {
    // Arrange
    const scenario = await handlerScenario();

    // Act
    const response = await scenario.leave(aliceId);

    // Assert
    expect(response.status).toBe(409);
    expect(scenario.participantStatus(aliceId)).toBe("COMMITTED");
  });
});

describe("handleVerifyAttendance", () => {
  test("handleVerifyAttendance_WhenBookerMarksEveryone_Returns200AwaitingPayout", async () => {
    // Arrange
    const scenario = await handlerScenario();
    scenario.setTime(hoursAfterSessionEnd(1));

    // Act
    const response = await scenario.verify(bookerId, [
      scenario.mark(aliceId, "ATTENDED"),
      scenario.mark(bobId, "ABSENT"),
    ]);

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessionId,
      status: "AWAITING_PAYOUT",
    });
  });

  test("handleVerifyAttendance_WhenCallerIsNotBooker_Returns403", async () => {
    // Arrange
    const scenario = await handlerScenario();
    scenario.setTime(hoursAfterSessionEnd(1));

    // Act
    const response = await scenario.verify(aliceId, [
      scenario.mark(bobId, "ABSENT"),
    ]);

    // Assert
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHORIZED" },
    });
  });

  test("handleVerifyAttendance_WhenSessionHasNotEnded_Returns409", async () => {
    // Arrange
    const scenario = await handlerScenario();

    // Act
    const response = await scenario.verify(bookerId, [
      scenario.mark(aliceId, "ATTENDED"),
    ]);

    // Assert
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SESSION_NOT_ENDED" },
    });
  });

  test("handleVerifyAttendance_WhenNoMarksAreSent_Returns400", async () => {
    // Arrange
    const scenario = await handlerScenario();
    scenario.setTime(hoursAfterSessionEnd(1));

    // Act
    const response = await scenario.verify(bookerId, []);

    // Assert
    expect(response.status).toBe(400);
  });

  test("handleVerifyAttendance_WhenAttendanceValueIsUnknown_Returns400", async () => {
    // Arrange
    const scenario = await handlerScenario();
    scenario.setTime(hoursAfterSessionEnd(1));

    // Act
    const response = await scenario.verify(bookerId, [
      { participationId: scenario.idOf(aliceId), attendance: "LATE" },
    ]);

    // Assert
    expect(response.status).toBe(400);
  });
});

/** alice and bob hold the session's two places; carol is waitlisted. */
async function handlerScenario() {
  const booker = readyBookerUser(bookerId);
  const unitOfWork = new InMemoryUnitOfWork({
    users: [
      createTestUserDetails({
        userId: bookerId,
        payoutAccount: booker.payoutAccount,
      }),
      ...[aliceId, bobId, carolId, daveId].map((userId) =>
        createTestUserDetails({ userId }),
      ),
    ],
    sessions: [new Session(sessionDetails({ sessionId, bookerId }))],
  });
  let now = hoursBeforeSessionStart(48);
  let nextId = 0;
  const dependencies = {
    unitOfWork,
    notifier: new RecordingNotifier(),
    clock: { now: () => now },
    ids: {
      next: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
    },
  };
  const participationIds = new Map<UUID, UUID>();
  const commitToSession = new CommitToSession(dependencies);
  for (const userId of [aliceId, bobId, carolId]) {
    const commitment = await commitToSession.forParticipant({
      userId,
      sessionId,
      idempotencyKey: "commit",
    });
    participationIds.set(userId, commitment.participationId);
  }
  const promote = new PromoteFromWaitlist(dependencies);
  const withdrawal = {
    withdrawFromSession: new WithdrawFromSession({ ...dependencies, promote }),
    acceptReplacement: new AcceptReplacement(dependencies),
    leaveWaitlist: new LeaveWaitlist({ ...dependencies, promote }),
  };
  const verifyAttendance = new VerifyAttendance(dependencies);
  const as = (userId: UUID) => async () => userId;
  const idOf = (userId: UUID) => participationIds.get(userId) ?? userId;

  return {
    unitOfWork,
    idOf,
    setTime(at: Date) {
      now = at;
    },
    mark(userId: UUID, attendance: "ATTENDED" | "ABSENT") {
      return { participationId: idOf(userId), attendance };
    },
    participantStatus(userId: UUID) {
      return unitOfWork
        .requireSession(sessionId)
        .participantList.findByUserId(userId)?.status;
    },
    withdraw(userId: UUID, body: unknown) {
      return handleWithdrawFromSession(jsonRequest(body), {
        authenticate: as(userId),
        ...withdrawal,
      });
    },
    accept(userId: UUID) {
      return handleAcceptReplacement(
        jsonRequest({ sessionId, idempotencyKey: "accept" }),
        { authenticate: as(userId), ...withdrawal },
      );
    },
    leave(userId: UUID) {
      return handleLeaveWaitlist(
        jsonRequest({ sessionId, idempotencyKey: "leave" }),
        { authenticate: as(userId), ...withdrawal },
      );
    },
    verify(userId: UUID, marks: unknown[]) {
      return handleVerifyAttendance(
        jsonRequest({ sessionId, idempotencyKey: "verify", marks }),
        { authenticate: as(userId), verifyAttendance },
      );
    },
  };
}

function withdrawBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    idempotencyKey: "withdraw",
    replacement: { mode: "OPEN_SLOT" },
    ...overrides,
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
