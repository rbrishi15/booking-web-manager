import { ReliabilityScore, Session } from "@/domain";
import {
  AcceptReplacement,
  ExpireSessionReplacements,
  WithdrawFromSession,
  type WithdrawFromSessionCommand,
} from "@/use-cases/sessions";
import { describe, expect, test, vi } from "vitest";
import {
  createTestSession,
  createTestUser,
  hoursBeforeSessionStart,
  sessionDetails,
  sessionStartsAt,
  sessionState,
} from "../domain/sessions/session/session-fixtures";
import { TestUnitOfWork } from "./support/transactional-test-unit-of-work";

// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-05 Withdraw from Session", () => {
  describe("Withdrawal", () => {
    test("execute_WhenMoreThanThirtyHoursRemain_RefundsTheSavedWithdrawal", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [createTestUser({ userId: "ben", availableFundsCents: 0 })],
      });
      const withdrawalTime = hoursBeforeSessionStart(31);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, withdrawalTime),
      );

      // Act
      const result = await useCase.execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      });

      // Assert
      expect(result).toEqual({ kind: "REFUNDED", participationId: "p-ben" });
      const saved = unitOfWork
        .readSession("s")!
        .participantList.requireParticipation("p-ben");
      expect(saved.status).toBe("WITHDRAWN");
      expect(saved.hold?.state).toBe("REFUNDED");
      expect(saved.withdrawnAt).toEqual(withdrawalTime);
      expect(saved.replacementMode).toBe("OPEN_SLOT");
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(500);
      expect(ledgerEntries(unitOfWork)).toEqual([
        {
          kind: "REFUND",
          participationId: "p-ben",
          amountCents: 500,
          occurredAt: withdrawalTime,
        },
      ]);
    });

    test("execute_WhenExactlyThirtyHoursRemain_AwaitsReplacementWithoutRefund", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [createTestUser({ userId: "ben", availableFundsCents: 0 })],
      });
      const refundCutoff = hoursBeforeSessionStart(30);

      // Act
      const result = await new WithdrawFromSession(
        dependenciesAt(unitOfWork, refundCutoff),
      ).execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      });

      // Assert
      expect(result).toEqual({
        kind: "AWAITING_REPLACEMENT",
        participationId: "p-ben",
      });
      expect(
        unitOfWork
          .readSession("s")!
          .participantList.requireParticipation("p-ben").hold?.state,
      ).toBe("AWAITING_REPLACEMENT");
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(0);
      expect(unitOfWork.ledgerInstructions).toEqual([]);
    });

    test("execute_WhenOneMillisecondBeforeRefundCutoff_RefundsTheHold", async () => {
      // Arrange
      const refundCutoff = hoursBeforeSessionStart(30);
      const oneMillisecondBeforeRefundCutoff = new Date(
        refundCutoff.getTime() - 1,
      );
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [createTestUser({ userId: "ben", availableFundsCents: 0 })],
      });

      // Act
      const result = await new WithdrawFromSession(
        dependenciesAt(unitOfWork, oneMillisecondBeforeRefundCutoff),
      ).execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      });

      // Assert
      expect(result.kind).toBe("REFUNDED");
      expect(unitOfWork.ledgerInstructions[0]?.occurredAt).toEqual(
        oneMillisecondBeforeRefundCutoff,
      );
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(500);
    });

    test("execute_WhenDirectInviteeIsInactiveAndUnfunded_ReservesTheirPlaceWithoutPromotingTheQueue", async () => {
      // Arrange
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["dana"],
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          createTestUser({ userId: "ben" }),
          createTestUser({
            userId: "cara",
            accountStatus: "INACTIVE",
            availableFundsCents: 0,
          }),
          createTestUser({ userId: "dana" }),
        ],
      });
      const dependencies = dependenciesAt(
        unitOfWork,
        hoursBeforeSessionStart(10),
      );

      // Act
      const result = await new WithdrawFromSession(dependencies).execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "invite-cara",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(result.kind).toBe("AWAITING_REPLACEMENT");
      expect(
        saved.participantList.personalReplacementForInvitee("cara")
          ?.participationId,
      ).toBe("p-ben");
      expect(saved.participantList.requireParticipation("p-dana").status).toBe(
        "WAITLISTED",
      );
      expect(saved.getAvailableSlots()).toBe(0);
      expect(unitOfWork.ledgerInstructions).toEqual([]);
      expect(dependencies.ids.next).not.toHaveBeenCalled();
    });

    test("execute_WhenAnOpenPlaceHasAFundedQueueHead_PromotesFIFOAndReturnsTheFinalRefund", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [
          createTestSession({
            committedUserIds: ["ben", "alex"],
            waitlistedUserIds: ["dana", "evan"],
          }),
        ],
        users: [
          createTestUser({ userId: "ben", availableFundsCents: 0 }),
          createTestUser({ userId: "dana", availableFundsCents: 500 }),
          createTestUser({ userId: "evan" }),
        ],
      });
      const withdrawalTime = hoursBeforeSessionStart(10);

      // Act
      const result = await new WithdrawFromSession(
        dependenciesAt(unitOfWork, withdrawalTime),
      ).execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(result).toEqual({ kind: "REFUNDED", participationId: "p-ben" });
      expect(saved.participantList.requireParticipation("p-dana").status).toBe(
        "COMMITTED",
      );
      expect(
        saved.participantList.requireParticipation("p-dana")
          .replacesParticipationId,
      ).toBe("p-ben");
      expect(saved.participantList.nextWaitlisted()?.userId).toBe("evan");
      expect(saved.participantList.nextQueueSequence).toBe(3);
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(500);
      expect(
        unitOfWork.readUser("dana")!.wallet.getAvailableBalance().toCents(),
      ).toBe(0);
      expect(ledgerEntries(unitOfWork)).toEqual([
        {
          kind: "LOCK",
          participationId: "p-dana",
          amountCents: 500,
          occurredAt: withdrawalTime,
        },
        {
          kind: "REFUND",
          participationId: "p-ben",
          amountCents: 500,
          occurredAt: withdrawalTime,
        },
      ]);
    });

    test("execute_WhenQueueHeadsAreIneligible_SkipsThemBeforePromotingTheNextEligibleUser", async () => {
      // Arrange
      const roster = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: [
          "inactive",
          "unreliable",
          "unfunded",
          "dana",
          "evan",
        ],
      });
      const session = new Session(
        sessionDetails({
          minimumReliability: ReliabilityScore.from(80),
          participations: roster.participantList.participations,
          nextQueueSequence: roster.participantList.nextQueueSequence,
        }),
      );
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          createTestUser({ userId: "ben" }),
          createTestUser({ userId: "inactive", accountStatus: "INACTIVE" }),
          createTestUser({
            userId: "unreliable",
            reliabilityScore: ReliabilityScore.from(79),
          }),
          createTestUser({ userId: "unfunded", availableFundsCents: 499 }),
          createTestUser({ userId: "dana", availableFundsCents: 500 }),
          createTestUser({ userId: "evan" }),
        ],
      });

      // Act
      await new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(10)),
      ).execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(
        saved.participantList.participations.map(({ userId, status }) => [
          userId,
          status,
        ]),
      ).toEqual([
        ["ben", "WITHDRAWN"],
        ["alex", "COMMITTED"],
        ["inactive", "LEFT_WAITLIST"],
        ["unreliable", "LEFT_WAITLIST"],
        ["unfunded", "LEFT_WAITLIST"],
        ["dana", "COMMITTED"],
        ["evan", "WAITLISTED"],
      ]);
      expect(
        unitOfWork.ledgerInstructions.map(({ kind, participationId }) => [
          kind,
          participationId,
        ]),
      ).toEqual([
        ["LOCK", "p-dana"],
        ["REFUND", "p-ben"],
      ]);
      expect(
        unitOfWork.readUser("unfunded")!.wallet.getAvailableBalance().toCents(),
      ).toBe(499);
      expect(
        unitOfWork.readUser("dana")!.wallet.getAvailableBalance().toCents(),
      ).toBe(0);
    });

    test("execute_WhenAnOlderOpenWithdrawalExists_RefundsItBeforeTheCurrentWithdrawal", async () => {
      // Arrange
      const benWithdrawalTime = hoursBeforeSessionStart(11);
      const alexWithdrawalTime = hoursBeforeSessionStart(10);
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["dana"],
      });
      const ben = createTestUser({ userId: "ben", availableFundsCents: 0 });
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: benWithdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          createTestUser({ userId: "alex", availableFundsCents: 0 }),
          createTestUser({ userId: "dana", availableFundsCents: 500 }),
        ],
      });

      // Act
      const result = await new WithdrawFromSession(
        dependenciesAt(unitOfWork, alexWithdrawalTime),
      ).execute({
        actorId: "alex",
        sessionId: "s",
        idempotencyKey: "withdraw-alex",
        replacementMode: "OPEN_SLOT",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(result).toEqual({
        kind: "AWAITING_REPLACEMENT",
        participationId: "p-alex",
      });
      expect(
        saved.participantList.requireParticipation("p-ben").hold?.state,
      ).toBe("REFUNDED");
      expect(
        saved.participantList.requireParticipation("p-alex").hold?.state,
      ).toBe("AWAITING_REPLACEMENT");
      expect(
        saved.participantList.requireParticipation("p-dana")
          .replacesParticipationId,
      ).toBe("p-ben");
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(500);
      expect(
        unitOfWork.readUser("alex")!.wallet.getAvailableBalance().toCents(),
      ).toBe(0);
    });

    test("execute_WhenTheQueueHeadHasAPersonalInvitation_LeavesTheQueueAndReservationUntouched", async () => {
      // Arrange
      const invitationTime = hoursBeforeSessionStart(11);
      const withdrawalTime = hoursBeforeSessionStart(10);
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["cara", "dana"],
      });
      const ben = createTestUser({ userId: "ben" });
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: invitationTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          createTestUser({ userId: "alex" }),
          createTestUser({ userId: "cara" }),
          createTestUser({ userId: "dana" }),
        ],
      });
      const reservationBefore = sessionState(session).participations[0];

      // Act
      await new WithdrawFromSession(
        dependenciesAt(unitOfWork, withdrawalTime),
      ).execute({
        actorId: "alex",
        sessionId: "s",
        idempotencyKey: "withdraw-alex",
        replacementMode: "OPEN_SLOT",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(sessionState(saved).participations[0]).toEqual(reservationBefore);
      expect(saved.participantList.nextWaitlisted()?.userId).toBe("cara");
      expect(saved.participantList.requireParticipation("p-dana").status).toBe(
        "WAITLISTED",
      );
      expect(saved.participantList.nextQueueSequence).toBe(3);
      expect(saved.getAvailableSlots()).toBe(1);
      expect(unitOfWork.ledgerInstructions).toEqual([]);
    });

    test("execute_WhenChangingDirectInvitationToOpenPlace_RejectsWithoutChangingStoredState", async () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [
          createTestUser({ userId: "ben" }),
          createTestUser({ userId: "cara" }),
        ],
      });
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, withdrawalTime),
      );
      await useCase.execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "invite-cara",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const previousState = storedState(unitOfWork, ["ben", "cara"]);

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "change-to-open",
          replacementMode: "OPEN_SLOT",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
    });

    test("execute_WhenChangingOpenPlaceToDirectInvitation_RejectsWithoutChangingStoredState", async () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [
          createTestUser({ userId: "ben" }),
          createTestUser({ userId: "cara" }),
        ],
      });
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, withdrawalTime),
      );
      await useCase.execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "open-place",
        replacementMode: "OPEN_SLOT",
      });
      const previousState = storedState(unitOfWork, ["ben", "cara"]);

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "change-to-personal",
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
    });

    test("execute_WhenTheActorIsMissing_RejectsWithoutChangingStoredState", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
      });
      const previousState = storedState(unitOfWork, []);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(10)),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "withdraw-ben",
          replacementMode: "OPEN_SLOT",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(storedState(unitOfWork, [])).toEqual(previousState);
    });

    test("execute_WhenTheSessionIsMissing_RejectsWithoutChangingStoredState", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        users: [createTestUser({ userId: "ben" })],
      });
      const previousState = storedState(unitOfWork, ["ben"]);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(10)),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "withdraw-ben",
          replacementMode: "OPEN_SLOT",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(storedState(unitOfWork, ["ben"])).toEqual(previousState);
    });

    test("execute_WhenTheNamedRecipientDoesNotExist_RejectsWithoutChangingStoredState", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [createTestUser({ userId: "ben" })],
      });
      const previousState = storedState(unitOfWork, ["ben"]);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(10)),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "invite-missing",
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "missing",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(storedState(unitOfWork, ["ben"])).toEqual(previousState);
    });

    test("execute_WhenTheActorHasNoParticipation_RejectsWithoutChangingAnotherPersonsPlace", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [createTestUser({ userId: "cara" })],
      });
      const previousState = storedState(unitOfWork, ["cara"]);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(10)),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "cara",
          sessionId: "s",
          idempotencyKey: "withdraw-cara",
          replacementMode: "OPEN_SLOT",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(storedState(unitOfWork, ["cara"])).toEqual(previousState);
    });
  });

  describe("Replacement acceptance", () => {
    test("execute_WhenNamedRecipientAcceptsAPrivatePlace_RefundsOnlyTheirOwnInviter", async () => {
      // Arrange
      const alexWithdrawalTime = hoursBeforeSessionStart(11);
      const roster = createTestSession({ committedUserIds: ["ben", "alex"] });
      const session = new Session(
        sessionDetails({
          visibility: "PRIVATE",
          participations: roster.participantList.participations,
        }),
      );
      const ben = createTestUser({ userId: "ben", availableFundsCents: 0 });
      const alex = createTestUser({ userId: "alex", availableFundsCents: 0 });
      alex.asParticipant().withdraw(session, {
        participationId: "p-alex",
        now: alexWithdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          alex,
          createTestUser({ userId: "cara", availableFundsCents: 500 }),
        ],
      });

      // Act
      const result = await new AcceptReplacement(
        dependenciesAt(unitOfWork, acceptanceTime),
      ).execute({
        actorId: "cara",
        sessionId: "s",
        idempotencyKey: "accept-cara",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(result).toEqual({
        kind: "COMMITTED",
        participationId: "generated-1",
        refundedParticipationId: "p-ben",
      });
      expect(
        saved.participantList.requireParticipation("generated-1")
          .replacesParticipationId,
      ).toBe("p-ben");
      expect(
        saved.participantList.requireParticipation("p-ben").hold?.state,
      ).toBe("REFUNDED");
      expect(
        saved.participantList.requireParticipation("p-alex").hold?.state,
      ).toBe("AWAITING_REPLACEMENT");
      expect(
        saved.participantList.personalReplacementForInvitee("cara"),
      ).toBeUndefined();
      expect(
        ["ben", "alex", "cara"].map((id) =>
          unitOfWork.readUser(id)!.wallet.getAvailableBalance().toCents(),
        ),
      ).toEqual([500, 0, 0]);
      expect(ledgerEntries(unitOfWork)).toEqual([
        {
          kind: "LOCK",
          participationId: "generated-1",
          amountCents: 500,
          occurredAt: acceptanceTime,
        },
        {
          kind: "REFUND",
          participationId: "p-ben",
          amountCents: 500,
          occurredAt: acceptanceTime,
        },
      ]);
    });

    test("execute_WhenTheInvitedRecipientIsBehindOtherWaiters_ReusesTheirParticipationAndPreservesFIFO", async () => {
      // Arrange
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["dana", "cara", "evan"],
      });
      const ben = createTestUser({ userId: "ben" });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          createTestUser({ userId: "cara", availableFundsCents: 500 }),
        ],
      });
      const dependencies = dependenciesAt(unitOfWork, acceptanceTime);

      // Act
      const result = await new AcceptReplacement(dependencies).execute({
        actorId: "cara",
        sessionId: "s",
        idempotencyKey: "accept-cara",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(result.participationId).toBe("p-cara");
      expect(
        saved.participantList.requireParticipation("p-cara").hold?.holdId,
      ).toBe("generated-1");
      expect(saved.participantList.nextWaitlisted()?.userId).toBe("dana");
      expect(
        saved.participantList.requireParticipation("p-dana").queueSequence,
      ).toBe(1);
      expect(
        saved.participantList.requireParticipation("p-evan").queueSequence,
      ).toBe(3);
      expect(saved.participantList.nextQueueSequence).toBe(4);
      expect(dependencies.ids.next).toHaveBeenCalledTimes(1);
    });

    test("execute_WhenTheInviterWasAlreadyRefunded_LocksTheRecipientShareWithoutAnotherRefund", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [
          createTestUser({ userId: "ben", availableFundsCents: 0 }),
          createTestUser({ userId: "cara", availableFundsCents: 500 }),
        ],
      });
      const withdrawalTime = hoursBeforeSessionStart(31);
      const acceptanceTime = hoursBeforeSessionStart(29);
      const dependencies = dependenciesAt(unitOfWork, withdrawalTime);
      await new WithdrawFromSession(dependencies).execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "invite-cara",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      dependencies.clock.now.mockReturnValue(acceptanceTime);

      // Act
      const result = await new AcceptReplacement(dependencies).execute({
        actorId: "cara",
        sessionId: "s",
        idempotencyKey: "accept-cara",
      });

      // Assert
      expect(result).toEqual({
        kind: "COMMITTED",
        participationId: "generated-1",
      });
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(500);
      expect(
        unitOfWork.readUser("cara")!.wallet.getAvailableBalance().toCents(),
      ).toBe(0);
      expect(
        unitOfWork.ledgerInstructions.map(({ kind, participationId }) => [
          kind,
          participationId,
        ]),
      ).toEqual([
        ["REFUND", "p-ben"],
        ["LOCK", "generated-1"],
      ]);
    });

    test("execute_WhenSomeoneOtherThanTheNamedRecipientAccepts_RejectsWithoutChangingStoredState", async () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben, createTestUser({ userId: "dana" })],
      });
      const previousState = storedState(unitOfWork, ["ben", "dana"]);
      const useCase = new AcceptReplacement(
        dependenciesAt(unitOfWork, acceptanceTime),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "dana",
          sessionId: "s",
          idempotencyKey: "accept-dana",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
      expect(storedState(unitOfWork, ["ben", "dana"])).toEqual(previousState);
    });

    test("execute_WhenTheRecipientCannotFundTheShare_PreservesTheirInvitationAndQueueEntry", async () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["cara", "dana"],
      });
      const ben = createTestUser({ userId: "ben" });
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          createTestUser({ userId: "cara", availableFundsCents: 499 }),
        ],
      });
      const previousState = storedState(unitOfWork, ["ben", "cara"]);
      const useCase = new AcceptReplacement(
        dependenciesAt(unitOfWork, acceptanceTime),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "cara",
          sessionId: "s",
          idempotencyKey: "accept-cara",
        }),
      ).rejects.toThrow(
        expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }),
      );
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
    });

    test("execute_WhenTheInvitationWasAlreadyAccepted_RejectsASecondAcceptanceWithANewKey", async () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben, createTestUser({ userId: "cara" })],
      });
      const useCase = new AcceptReplacement(
        dependenciesAt(unitOfWork, acceptanceTime),
      );
      await useCase.execute({
        actorId: "cara",
        sessionId: "s",
        idempotencyKey: "accept-cara",
      });
      const previousState = storedState(unitOfWork, ["ben", "cara"]);

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "cara",
          sessionId: "s",
          idempotencyKey: "accept-cara-again",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
    });

    test("execute_WhenAcceptingAtSessionStart_RejectsWithoutConsumingTheReservation", async () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben, createTestUser({ userId: "cara" })],
      });
      const previousState = storedState(unitOfWork, ["ben", "cara"]);
      const useCase = new AcceptReplacement(
        dependenciesAt(unitOfWork, sessionStartsAt),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "cara",
          sessionId: "s",
          idempotencyKey: "accept-cara",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
    });

    test("execute_WhenTheInvitedQueueHeadAccepts_FillsEveryOpenPlaceAndPreservesAnotherReservation", async () => {
      // Arrange
      const session = createTestSession({
        totalSlots: 5,
        committedUserIds: ["ben", "alex", "dan", "evan", "frank"],
        waitlistedUserIds: ["cara", "gia", "hana", "ivan"],
      });
      const ben = createTestUser({ userId: "ben", availableFundsCents: 0 });
      const alex = createTestUser({ userId: "alex", availableFundsCents: 0 });
      const dan = createTestUser({ userId: "dan", availableFundsCents: 0 });
      const evan = createTestUser({ userId: "evan", availableFundsCents: 0 });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      alex.asParticipant().withdraw(session, {
        participationId: "p-alex",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "ivan",
      });
      dan.asParticipant().withdraw(session, {
        participationId: "p-dan",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      evan.asParticipant().withdraw(session, {
        participationId: "p-evan",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          alex,
          dan,
          evan,
          createTestUser({ userId: "cara", availableFundsCents: 200 }),
          createTestUser({ userId: "gia", availableFundsCents: 200 }),
          createTestUser({ userId: "hana", availableFundsCents: 200 }),
          createTestUser({ userId: "ivan", availableFundsCents: 200 }),
        ],
      });

      // Act
      const result = await new AcceptReplacement(
        dependenciesAt(unitOfWork, acceptanceTime),
      ).execute({
        actorId: "cara",
        sessionId: "s",
        idempotencyKey: "accept-cara",
      });

      // Assert
      const saved = unitOfWork.readSession("s")!;
      expect(result).toEqual({
        kind: "COMMITTED",
        participationId: "p-cara",
        refundedParticipationId: "p-ben",
      });
      expect(saved.participantList.committedCount).toBe(4);
      expect(saved.getAvailableSlots()).toBe(0);
      expect(saved.participantList.nextWaitlisted()?.userId).toBe("ivan");
      expect(
        saved.participantList.personalReplacementForInvitee("ivan")
          ?.participationId,
      ).toBe("p-alex");
      expect(
        saved.participantList.requireParticipation("p-alex").hold?.state,
      ).toBe("AWAITING_REPLACEMENT");
      expect(saved.participantList.nextQueueSequence).toBe(5);
      expect(
        unitOfWork.ledgerInstructions.map(({ kind, participationId }) => [
          kind,
          participationId,
        ]),
      ).toEqual([
        ["LOCK", "p-cara"],
        ["REFUND", "p-ben"],
        ["LOCK", "p-gia"],
        ["REFUND", "p-dan"],
        ["LOCK", "p-hana"],
        ["REFUND", "p-evan"],
      ]);
      expect(
        ["ben", "dan", "evan", "cara", "gia", "hana", "alex", "ivan"].map(
          (userId) =>
            unitOfWork.readUser(userId)!.wallet.getAvailableBalance().toCents(),
        ),
      ).toEqual([200, 200, 200, 0, 0, 0, 0, 200]);
    });
  });

  describe("Replacement expiry", () => {
    test("execute_WhenOneMillisecondBeforeSessionStart_RejectsWithoutChangingStoredState", async () => {
      // Arrange
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const oneMillisecondBeforeSessionStart = new Date(
        sessionStartsAt.getTime() - 1,
      );
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben],
      });
      const previousState = storedState(unitOfWork, ["ben"]);
      const useCase = new ExpireSessionReplacements(
        dependenciesAt(unitOfWork, oneMillisecondBeforeSessionStart),
      );

      // Act & Assert
      await expect(
        useCase.execute({ sessionId: "s", idempotencyKey: "expire-s" }),
      ).rejects.toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(storedState(unitOfWork, ["ben"])).toEqual(previousState);
    });

    test("execute_WhenAPrematureAttemptRetriesAtSessionStart_ExpiresWithTheSameKeyWithoutPayingOut", async () => {
      // Arrange
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      const alex = createTestUser({ userId: "alex" });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const oneMillisecondBeforeSessionStart = new Date(
        sessionStartsAt.getTime() - 1,
      );
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      alex.asParticipant().withdraw(session, {
        participationId: "p-alex",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben, alex],
      });
      const dependencies = dependenciesAt(
        unitOfWork,
        oneMillisecondBeforeSessionStart,
      );
      const useCase = new ExpireSessionReplacements(dependencies);
      const command = { sessionId: "s", idempotencyKey: "expire-s" };
      await expect(useCase.execute(command)).rejects.toThrow(
        expect.objectContaining({ code: "INVALID_STATE" }),
      );
      dependencies.clock.now.mockReturnValue(sessionStartsAt);

      // Act
      const result = await useCase.execute(command);

      // Assert
      expect(result).toEqual({ expiredParticipationIds: ["p-ben", "p-alex"] });
      expect(
        unitOfWork
          .readSession("s")!
          .participantList.participations.map((p) => p.hold?.state),
      ).toEqual(["FORFEITURE_DUE", "FORFEITURE_DUE"]);
      expect(unitOfWork.ledgerInstructions).toEqual([]);
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(10_000);
      expect(unitOfWork.workCalls).toBe(2);
      expect(dependencies.ids.next).not.toHaveBeenCalled();
    });

    test("execute_WhenSuccessfulExpiryIsReplayed_ReturnsTheOriginalExpiredIdentifiers", async () => {
      // Arrange
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      const withdrawalTime = hoursBeforeSessionStart(10);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben],
      });
      const dependencies = dependenciesAt(unitOfWork, sessionStartsAt);
      const useCase = new ExpireSessionReplacements(dependencies);
      const command = { sessionId: "s", idempotencyKey: "expire-s" };
      const first = await useCase.execute(command);
      const previousState = storedState(unitOfWork, ["ben"]);

      // Act
      const replay = await useCase.execute(command);

      // Assert
      expect(replay).toEqual(first);
      expect(replay).toEqual({ expiredParticipationIds: ["p-ben"] });
      expect(storedState(unitOfWork, ["ben"])).toEqual(previousState);
      expect(dependencies.clock.now).toHaveBeenCalledTimes(1);
      expect(unitOfWork.workCalls).toBe(1);
    });

    test("execute_WhenAlreadyExpiredWithANewKey_DoesNotExpireOrMoveFundsAgain", async () => {
      // Arrange
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      const withdrawalTime = hoursBeforeSessionStart(10);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben],
      });
      const useCase = new ExpireSessionReplacements(
        dependenciesAt(unitOfWork, sessionStartsAt),
      );
      await useCase.execute({ sessionId: "s", idempotencyKey: "expire-first" });
      const previousState = storedState(unitOfWork, ["ben"]);

      // Act
      const result = await useCase.execute({
        sessionId: "s",
        idempotencyKey: "expire-second",
      });

      // Assert
      expect(result).toEqual({ expiredParticipationIds: [] });
      expect(storedState(unitOfWork, ["ben"])).toEqual(previousState);
    });

    test("execute_WhenTheWithdrawnHoldWasRefunded_LeavesItsTerminalStateAndFundsUnchanged", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [
          createTestUser({ userId: "ben", availableFundsCents: 0 }),
          createTestUser({ userId: "cara" }),
        ],
      });
      const withdrawalTime = hoursBeforeSessionStart(31);
      const dependencies = dependenciesAt(unitOfWork, withdrawalTime);
      await new WithdrawFromSession(dependencies).execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "invite-cara",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const previousState = storedState(unitOfWork, ["ben", "cara"]);
      dependencies.clock.now.mockReturnValue(sessionStartsAt);

      // Act
      const result = await new ExpireSessionReplacements(dependencies).execute({
        sessionId: "s",
        idempotencyKey: "expire-s",
      });

      // Assert
      expect(result).toEqual({ expiredParticipationIds: [] });
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
      expect(
        unitOfWork
          .readSession("s")!
          .participantList.requireParticipation("p-ben").hold?.state,
      ).toBe("REFUNDED");
    });
  });

  describe("Atomicity and replay", () => {
    test("execute_WhenWithdrawalIsReplayed_ReturnsPlainOriginalResultWithoutRunningWorkAgain", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [
          createTestSession({
            committedUserIds: ["ben", "alex"],
            waitlistedUserIds: ["dana"],
          }),
        ],
        users: [
          createTestUser({ userId: "ben" }),
          createTestUser({ userId: "dana" }),
        ],
      });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const dependencies = dependenciesAt(unitOfWork, withdrawalTime);
      const useCase = new WithdrawFromSession(dependencies);
      const command: WithdrawFromSessionCommand = {
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      };
      const first = await useCase.execute(command);
      const previousState = storedState(unitOfWork, ["ben", "dana"]);
      dependencies.clock.now.mockReturnValue(sessionStartsAt);

      // Act
      const replay = await useCase.execute(command);

      // Assert
      expect(replay).toEqual({ kind: "REFUNDED", participationId: "p-ben" });
      expect(replay).toEqual(first);
      expect(JSON.parse(JSON.stringify(replay))).toEqual(replay);
      expect(storedState(unitOfWork, ["ben", "dana"])).toEqual(previousState);
      expect(dependencies.clock.now).toHaveBeenCalledTimes(1);
      expect(dependencies.ids.next).toHaveBeenCalledTimes(1);
      expect(unitOfWork.workCalls).toBe(1);
    });

    test("execute_WhenAcceptanceIsReplayed_ReturnsPlainOriginalResultWithoutLockingOrRefundingAgain", async () => {
      // Arrange
      const session = createTestSession({ committedUserIds: ["ben", "alex"] });
      const ben = createTestUser({ userId: "ben" });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben, createTestUser({ userId: "cara" })],
      });
      const dependencies = dependenciesAt(unitOfWork, acceptanceTime);
      const useCase = new AcceptReplacement(dependencies);
      const command = {
        actorId: "cara",
        sessionId: "s",
        idempotencyKey: "accept-cara",
      };
      const first = await useCase.execute(command);
      const previousState = storedState(unitOfWork, ["ben", "cara"]);

      // Act
      const replay = await useCase.execute(command);

      // Assert
      expect(replay).toEqual(first);
      expect(replay).toEqual({
        kind: "COMMITTED",
        participationId: "generated-1",
        refundedParticipationId: "p-ben",
      });
      expect(JSON.parse(JSON.stringify(replay))).toEqual(replay);
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
      expect(dependencies.clock.now).toHaveBeenCalledTimes(1);
      expect(dependencies.ids.next).toHaveBeenCalledTimes(2);
      expect(unitOfWork.workCalls).toBe(1);
    });

    test("execute_WhenTheSameKeyChangesTheInvitationRecipient_RejectsTheConflictWithoutChangingState", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [createTestSession({ committedUserIds: ["ben", "alex"] })],
        users: [
          createTestUser({ userId: "ben" }),
          createTestUser({ userId: "cara" }),
          createTestUser({ userId: "dana" }),
        ],
      });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const dependencies = dependenciesAt(unitOfWork, withdrawalTime);
      const useCase = new WithdrawFromSession(dependencies);
      await useCase.execute({
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "invite",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const previousState = storedState(unitOfWork, ["ben", "cara", "dana"]);

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "invite",
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "dana",
        }),
      ).rejects.toThrow(
        expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
      );
      expect(storedState(unitOfWork, ["ben", "cara", "dana"])).toEqual(
        previousState,
      );
      expect(dependencies.clock.now).toHaveBeenCalledTimes(1);
    });

    test("execute_WhenAnotherScopeUsedTheSameRequest_RejectsWithoutRunningAcceptance", async () => {
      // Arrange
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["cara"],
      });
      const ben = createTestUser({ userId: "ben" });
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [ben, createTestUser({ userId: "cara" })],
      });
      const request = { actorId: "cara", sessionId: "s" };
      // The queue entry came from a prior operation with exactly this payload.
      await unitOfWork.execute(
        { idempotencyKey: "shared-key", scope: "UC2-04:commit", request },
        async () => ({ kind: "WAITLISTED", participationId: "p-cara" }),
      );
      const dependencies = dependenciesAt(unitOfWork, acceptanceTime);
      const previousState = storedState(unitOfWork, ["ben", "cara"]);
      const useCase = new AcceptReplacement(dependencies);

      // Act & Assert
      await expect(
        useCase.execute({ ...request, idempotencyKey: "shared-key" }),
      ).rejects.toThrow(
        expect.objectContaining({ code: "IDEMPOTENCY_CONFLICT" }),
      );
      expect(storedState(unitOfWork, ["ben", "cara"])).toEqual(previousState);
      expect(dependencies.clock.now).not.toHaveBeenCalled();
      expect(dependencies.ids.next).not.toHaveBeenCalled();
      expect(unitOfWork.workCalls).toBe(1);
    });

    test("execute_WhenSessionSaveFails_RollsBackWithdrawalPromotionAndLedgerWrites", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [
          createTestSession({
            committedUserIds: ["ben", "alex"],
            waitlistedUserIds: ["dana"],
          }),
        ],
        users: [
          createTestUser({ userId: "ben", availableFundsCents: 0 }),
          createTestUser({ userId: "dana", availableFundsCents: 500 }),
        ],
      });
      const failure = new Error("Session save failed");
      unitOfWork.failNextSessionSave(failure);
      const previousState = storedState(unitOfWork, ["ben", "dana"]);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(10)),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "withdraw-ben",
          replacementMode: "OPEN_SLOT",
        }),
      ).rejects.toBe(failure);
      expect(storedState(unitOfWork, ["ben", "dana"])).toEqual(previousState);
    });

    test("execute_WhenRetryingAfterSessionSaveFailure_ReusesTheKeyAndCommitsExactlyOnce", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [
          createTestSession({
            committedUserIds: ["ben", "alex"],
            waitlistedUserIds: ["dana"],
          }),
        ],
        users: [
          createTestUser({ userId: "ben", availableFundsCents: 0 }),
          createTestUser({ userId: "dana", availableFundsCents: 500 }),
        ],
      });
      const failure = new Error("Session save failed");
      unitOfWork.failNextSessionSave(failure);
      const withdrawalTime = hoursBeforeSessionStart(10);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, withdrawalTime),
      );
      const command: WithdrawFromSessionCommand = {
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      };
      await expect(useCase.execute(command)).rejects.toBe(failure);

      // Act
      const result = await useCase.execute(command);

      // Assert
      expect(result).toEqual({ kind: "REFUNDED", participationId: "p-ben" });
      expect(unitOfWork.ledgerInstructions.map(({ kind }) => kind)).toEqual([
        "LOCK",
        "REFUND",
      ]);
      expect(
        unitOfWork.readUser("ben")!.wallet.getAvailableBalance().toCents(),
      ).toBe(500);
      expect(
        unitOfWork.readUser("dana")!.wallet.getAvailableBalance().toCents(),
      ).toBe(0);
      expect(
        unitOfWork
          .readSession("s")!
          .participantList.requireParticipation("p-dana").status,
      ).toBe("COMMITTED");
    });

    test("execute_WhenALaterLedgerAppendFails_RollsBackEarlierPromotionSkippedWaiterAndWithdrawal", async () => {
      // Arrange
      const session = createTestSession({
        totalSlots: 4,
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["dana", "unfunded", "eric"],
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          createTestUser({ userId: "ben", availableFundsCents: 0 }),
          createTestUser({ userId: "dana", availableFundsCents: 250 }),
          createTestUser({ userId: "unfunded", availableFundsCents: 0 }),
          createTestUser({ userId: "eric", availableFundsCents: 250 }),
        ],
      });
      const failure = new Error("Third ledger append failed");
      unitOfWork.failLedgerAppendAt(3, failure);
      const previousState = storedState(unitOfWork, [
        "ben",
        "dana",
        "unfunded",
        "eric",
      ]);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(31)),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "withdraw-ben",
          replacementMode: "OPEN_SLOT",
        }),
      ).rejects.toBe(failure);
      expect(
        storedState(unitOfWork, ["ben", "dana", "unfunded", "eric"]),
      ).toEqual(previousState);
    });

    test("execute_WhenRetryingAfterALaterLedgerFailure_CommitsAllPromotionsWithTheSameKey", async () => {
      // Arrange
      const session = createTestSession({
        totalSlots: 4,
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["dana", "unfunded", "eric"],
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          createTestUser({ userId: "ben", availableFundsCents: 0 }),
          createTestUser({ userId: "dana", availableFundsCents: 250 }),
          createTestUser({ userId: "unfunded", availableFundsCents: 0 }),
          createTestUser({ userId: "eric", availableFundsCents: 250 }),
        ],
      });
      const failure = new Error("Third ledger append failed");
      unitOfWork.failLedgerAppendAt(3, failure);
      const withdrawalTime = hoursBeforeSessionStart(31);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, withdrawalTime),
      );
      const command: WithdrawFromSessionCommand = {
        actorId: "ben",
        sessionId: "s",
        idempotencyKey: "withdraw-ben",
        replacementMode: "OPEN_SLOT",
      };
      await expect(useCase.execute(command)).rejects.toBe(failure);

      // Act
      const result = await useCase.execute(command);

      // Assert
      expect(result.kind).toBe("REFUNDED");
      const saved = unitOfWork.readSession("s")!;
      expect(saved.participantList.requireParticipation("p-dana").status).toBe(
        "COMMITTED",
      );
      expect(saved.participantList.requireParticipation("p-eric").status).toBe(
        "COMMITTED",
      );
      expect(
        saved.participantList.requireParticipation("p-unfunded").status,
      ).toBe("LEFT_WAITLIST");
      expect(saved.participantList.nextQueueSequence).toBe(4);
      expect(
        unitOfWork.ledgerInstructions.map(({ kind, participationId }) => [
          kind,
          participationId,
        ]),
      ).toEqual([
        ["REFUND", "p-ben"],
        ["LOCK", "p-dana"],
        ["LOCK", "p-eric"],
      ]);
      expect(
        ["ben", "dana", "unfunded", "eric"].map((userId) =>
          unitOfWork.readUser(userId)!.wallet.getAvailableBalance().toCents(),
        ),
      ).toEqual([250, 0, 0, 0]);
    });

    test("execute_WhenPromotionAfterAcceptanceFails_RollsBackAcceptanceReservationConsumptionAndRefund", async () => {
      // Arrange
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["cara", "dana"],
      });
      const ben = createTestUser({ userId: "ben", availableFundsCents: 0 });
      const alex = createTestUser({ userId: "alex", availableFundsCents: 0 });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      alex.asParticipant().withdraw(session, {
        participationId: "p-alex",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          alex,
          createTestUser({ userId: "cara", availableFundsCents: 500 }),
          createTestUser({ userId: "dana", availableFundsCents: 500 }),
        ],
      });
      const failure = new Error("Promotion ledger append failed");
      unitOfWork.failLedgerAppendAt(2, failure);
      const previousState = storedState(unitOfWork, [
        "ben",
        "alex",
        "cara",
        "dana",
      ]);
      const useCase = new AcceptReplacement(
        dependenciesAt(unitOfWork, acceptanceTime),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "cara",
          sessionId: "s",
          idempotencyKey: "accept-cara",
        }),
      ).rejects.toBe(failure);
      expect(storedState(unitOfWork, ["ben", "alex", "cara", "dana"])).toEqual(
        previousState,
      );
    });

    test("execute_WhenRetryingAcceptanceAfterPromotionFailure_ConsumesTheInvitationAndPromotesExactlyOnce", async () => {
      // Arrange
      const session = createTestSession({
        committedUserIds: ["ben", "alex"],
        waitlistedUserIds: ["cara", "dana"],
      });
      const ben = createTestUser({ userId: "ben", availableFundsCents: 0 });
      const alex = createTestUser({ userId: "alex", availableFundsCents: 0 });
      const withdrawalTime = hoursBeforeSessionStart(10);
      const acceptanceTime = hoursBeforeSessionStart(9);
      ben.asParticipant().withdraw(session, {
        participationId: "p-ben",
        now: withdrawalTime,
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
      alex.asParticipant().withdraw(session, {
        participationId: "p-alex",
        now: withdrawalTime,
        replacementMode: "OPEN_SLOT",
      });
      const unitOfWork = new TestUnitOfWork({
        sessions: [session],
        users: [
          ben,
          alex,
          createTestUser({ userId: "cara", availableFundsCents: 500 }),
          createTestUser({ userId: "dana", availableFundsCents: 500 }),
        ],
      });
      const failure = new Error("Promotion ledger append failed");
      unitOfWork.failLedgerAppendAt(2, failure);
      const useCase = new AcceptReplacement(
        dependenciesAt(unitOfWork, acceptanceTime),
      );
      const command = {
        actorId: "cara",
        sessionId: "s",
        idempotencyKey: "accept-cara",
      };
      await expect(useCase.execute(command)).rejects.toBe(failure);

      // Act
      const result = await useCase.execute(command);

      // Assert
      expect(result).toEqual({
        kind: "COMMITTED",
        participationId: "p-cara",
        refundedParticipationId: "p-ben",
      });
      const saved = unitOfWork.readSession("s")!;
      expect(saved.participantList.committedCount).toBe(2);
      expect(
        saved.participantList.personalReplacementForInvitee("cara"),
      ).toBeUndefined();
      expect(saved.participantList.nextWaitlisted()).toBeUndefined();
      expect(
        unitOfWork.ledgerInstructions.map(({ kind, participationId }) => [
          kind,
          participationId,
        ]),
      ).toEqual([
        ["LOCK", "p-cara"],
        ["REFUND", "p-ben"],
        ["LOCK", "p-dana"],
        ["REFUND", "p-alex"],
      ]);
      expect(
        ["ben", "alex", "cara", "dana"].map((userId) =>
          unitOfWork.readUser(userId)!.wallet.getAvailableBalance().toCents(),
        ),
      ).toEqual([500, 500, 0, 0]);
    });

    test("execute_WhenAQueuedUserCannotBeLoaded_RollsBackTheAlreadyStagedWithdrawalRefund", async () => {
      // Arrange
      const unitOfWork = new TestUnitOfWork({
        sessions: [
          createTestSession({
            committedUserIds: ["ben", "alex"],
            waitlistedUserIds: ["missing"],
          }),
        ],
        users: [createTestUser({ userId: "ben", availableFundsCents: 0 })],
      });
      const previousState = storedState(unitOfWork, ["ben"]);
      const useCase = new WithdrawFromSession(
        dependenciesAt(unitOfWork, hoursBeforeSessionStart(31)),
      );

      // Act & Assert
      await expect(
        useCase.execute({
          actorId: "ben",
          sessionId: "s",
          idempotencyKey: "withdraw-ben",
          replacementMode: "OPEN_SLOT",
        }),
      ).rejects.toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(storedState(unitOfWork, ["ben"])).toEqual(previousState);
    });
  });
});

function dependenciesAt(unitOfWork: TestUnitOfWork, now: Date) {
  let sequence = 0;
  return {
    unitOfWork,
    clock: { now: vi.fn(() => new Date(now)) },
    ids: { next: vi.fn(() => `generated-${++sequence}`) },
  };
}

function ledgerEntries(unitOfWork: TestUnitOfWork) {
  return unitOfWork.ledgerInstructions.map(
    ({ kind, participationId, amount, occurredAt }) => ({
      kind,
      participationId,
      amountCents: amount.toCents(),
      occurredAt,
    }),
  );
}

/** Capture committed observations, including wallet history and nested domain values. */
function storedState(unitOfWork: TestUnitOfWork, userIds: readonly string[]) {
  const session = unitOfWork.readSession("s");
  return {
    session: session === undefined ? undefined : sessionState(session),
    users: userIds.map((userId) => {
      const user = unitOfWork.readUser(userId)!;
      return {
        userId,
        balanceCents: user.wallet.getAvailableBalance().toCents(),
        transactions: user.wallet.transactions.map((entry) => ({
          transactionId: entry.transactionId,
          kind: entry.kind,
          amountCents: entry.amount.toCents(),
          occurredAt: entry.occurredAt,
          holdId: entry.holdId,
        })),
      };
    }),
    instructions: unitOfWork.ledgerInstructions.map((instruction) => ({
      ...instruction,
      amount: instruction.amount.toCents(),
    })),
  };
}
