import { ReliabilityScore } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  at,
  before,
  creationDetails,
  createTestUser,
  createTestSession,
  readyBooker,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("join_WhenNamedInviteeHasPendingInvitation_RejectsUntilExplicitAcceptance", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(20),
        replacementMode: "OPEN_SLOT",
      });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "cara" })
        .asParticipant()
        .join(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: at(9),
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.participantList.findByUserId("cara")).toBeUndefined();
    expect(
      bookingSession.participantList.personalReplacementForInvitee("cara")
        ?.participationId,
    ).toBe("p-ben");
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.getAvailableSlots(at(9))).toBe(1);
  });

  test("acceptReplacement_WhenUserHasNoPendingInvitation_RejectsWithoutChangingReservedSeat", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "dana" })
        .asParticipant()
        .acceptReplacement(bookingSession, {
          participationId: "p-dana",
          holdId: "h-dana",
          now: at(9),
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.getAvailableSlots(at(9))).toBe(0);
    expect(
      bookingSession.participantList.requireParticipation("p-ben")
        .replacementInviteeId,
    ).toBe("cara");
  });

  test("acceptReplacement_WhenNamedInviteeIsBehindOtherWaiters_AcceptsOnlyTheirReservedSeat", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
      waitlistedUserIds: ["dana", "cara", "evan"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
    const queueSequence = bookingSession.participantList.nextQueueSequence;

    // Act
    const admission = createTestUser({ userId: "cara" })
      .asParticipant()
      .acceptReplacement(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        now: at(9),
      });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(admission.refundedParticipationId).toBe("p-ben");
    expect(
      admission.instructions.map((instruction) => instruction.kind),
    ).toEqual(["LOCK", "REFUND"]);
    const cara = bookingSession.participantList.requireParticipation("p-cara");
    expect(cara.status).toBe("COMMITTED");
    expect(cara.queueSequence).toBe(2);
    expect(cara.replacesParticipationId).toBe("p-ben");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );
    expect(bookingSession.participantList.committedCount).toBe(2);
    expect(bookingSession.getAvailableSlots(at(9))).toBe(0);
  });

  test("acceptReplacement_WhenQueuedInviteeCannotPay_KeepsReservationAndQueuePosition", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
      waitlistedUserIds: ["dana", "cara"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
    const participant = createTestUser({
      userId: "cara",
      availableFundsCents: 499,
    }).asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.acceptReplacement(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        now: at(9),
      }),
    ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.getAvailableSlots(at(9))).toBe(0);
    expect(
      bookingSession.participantList.requireParticipation("p-cara")
        .queueSequence,
    ).toBe(2);
  });

  test("acceptReplacement_WhenInviteeIsInactive_RejectsWithoutChangingReservation", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
        now: at(10),
      });
    const participant = createTestUser({
      userId: "cara",
      accountStatus: "INACTIVE",
    }).asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.acceptReplacement(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        now: at(9),
      }),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("acceptReplacement_WhenInviteeIsBelowReliabilityThreshold_RejectsWithoutChangingReservation", () => {
    // Arrange
    const bookingSession = readyBooker().createSession({
      ...creationDetails(),
      minimumReliability: ReliabilityScore.from(80),
    });
    const ben = createTestUser({ userId: "ben" }).asParticipant();
    ben.join(bookingSession, {
      participationId: "p-ben",
      holdId: "h-ben",
      now: before,
    });
    ben.withdraw(bookingSession, {
      participationId: "p-ben",
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "cara",
      now: at(10),
    });
    const participant = createTestUser({
      userId: "cara",
      reliabilityScore: ReliabilityScore.from(79),
    }).asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.acceptReplacement(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        now: at(9),
      }),
    ).toThrow(expect.objectContaining({ code: "LOW_RELIABILITY" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("acceptReplacement_WhenSessionStartsNow_RejectsUnacceptedInvitation", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
        now: at(10),
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "cara" })
        .asParticipant()
        .acceptReplacement(bookingSession, {
          participationId: "p-cara",
          holdId: "h-cara",
          now: start,
        }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("acceptReplacement_WhenInviterWasAlreadyRefunded_AcceptsSeatWithoutRefundingAnotherWithdrawal", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(40),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(20),
        replacementMode: "OPEN_SLOT",
      });
    const refundedHold =
      bookingSession.participantList.requireParticipation("p-ben").hold;

    // Act
    const admission = createTestUser({ userId: "cara" })
      .asParticipant()
      .acceptReplacement(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        now: at(19),
      });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(admission.refundedParticipationId).toBeUndefined();
    expect(
      admission.instructions.map((instruction) => instruction.kind),
    ).toEqual(["LOCK"]);
    expect(
      bookingSession.participantList.requireParticipation("p-cara")
        .replacesParticipationId,
    ).toBe("p-ben");
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold,
    ).toBe(refundedHold);
    expect(refundedHold?.state).toBe("REFUNDED");
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.getAvailableSlots(at(19))).toBe(1);
  });

  test("acceptReplacement_WhenEarlyInvitationHasBeenAccepted_RejectsReplayEvenWithAnOpenSeat", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(40),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
    const participant = createTestUser({ userId: "cara" }).asParticipant();
    participant.acceptReplacement(bookingSession, {
      participationId: "p-cara",
      holdId: "h-cara",
      now: at(39),
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.acceptReplacement(bookingSession, {
        participationId: "p-cara",
        holdId: "h-another",
        now: at(38),
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_ACCESS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(bookingSession.participantList.committedCount).toBe(1);
    expect(bookingSession.getAvailableSlots(at(38))).toBe(1);
  });
});
