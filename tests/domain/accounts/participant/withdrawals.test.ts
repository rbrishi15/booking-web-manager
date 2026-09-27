import { describe, expect, test } from "vitest";
import {
  at,
  before,
  hour,
  createTestUser,
  createTestSession,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("withdraw_WhenParticipantDirectlyInvitesSomeone_ReservesSeatWithoutCommittingInviteeOrRefunding", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
    });

    // Act
    const withdrawal = createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
        now: at(10),
      });

    // Assert
    expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
    expect(withdrawal.instructions).toEqual([]);
    expect(bookingSession.participantList.findByUserId("cara")).toBeUndefined();
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold?.state,
    ).toBe("AWAITING_REPLACEMENT");
    expect(
      bookingSession.participantList.personalReplacementForInvitee("cara")
        ?.participationId,
    ).toBe("p-ben");
    expect(bookingSession.participantList.committedCount).toBe(1);
    expect(bookingSession.participantList.reservedCount).toBe(1);
    expect(bookingSession.getAvailableSlots(at(10))).toBe(0);
  });

  test("withdraw_WhenInviteeAlreadyWaits_KeepsTheirQueueEntryUntilTheyAccept", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
      waitlistedUserIds: ["dana", "cara"],
    });
    const waiting =
      bookingSession.participantList.requireParticipation("p-cara");
    const queueSequence = bookingSession.participantList.nextQueueSequence;

    // Act
    const withdrawal = createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
        now: at(10),
      });

    // Assert
    expect(withdrawal.instructions).toEqual([]);
    expect(bookingSession.participantList.requireParticipation("p-cara")).toBe(
      waiting,
    );
    expect(waiting.status).toBe("WAITLISTED");
    expect(waiting.hold).toBeUndefined();
    expect(waiting.queueSequence).toBe(2);
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );
    expect(bookingSession.participantList.reservedCount).toBe(1);
  });

  test("withdraw_WhenParticipantChoseInvitation_RejectsSwitchToWaitlistAndKeepsReservedSeat", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["dana"],
    });
    const participant = createTestUser({ userId: "alice" }).asParticipant();
    participant.withdraw(bookingSession, {
      participationId: "p-alice",
      now: at(10),
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "cara",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(9),
        replacementMode: "OPEN_SLOT",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    const withdrawn =
      bookingSession.participantList.requireParticipation("p-alice");
    expect(withdrawn.replacementMode).toBe("DIRECT_INVITE");
    expect(withdrawn.replacementInviteeId).toBe("cara");
    expect(bookingSession.getAvailableSlots(at(9))).toBe(0);
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
  });

  test("withdraw_WhenParticipantChoseWaitlist_RejectsSwitchToInvitationAndKeepsOpenSeat", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
      waitlistedUserIds: ["dana"],
    });
    const participant = createTestUser({ userId: "alice" }).asParticipant();
    participant.withdraw(bookingSession, {
      participationId: "p-alice",
      now: at(10),
      replacementMode: "OPEN_SLOT",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      participant.withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(9),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    const withdrawn =
      bookingSession.participantList.requireParticipation("p-alice");
    expect(withdrawn.replacementMode).toBe("OPEN_SLOT");
    expect(withdrawn.replacementInviteeId).toBeUndefined();
    expect(bookingSession.getAvailableSlots(at(9))).toBe(1);
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
  });

  test("withdraw_WhenOneMillisecondBeforeRefundCutoff_RefundsHold", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    // Act
    const withdrawal = createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(30 + 1 / hour),
      });

    // Assert
    expect(withdrawal.kind).toBe("REFUNDED");
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("REFUNDED");
  });

  test("withdraw_WhenEarlyParticipantInvitesOnePerson_RefundsAndReservesTheirSeat", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });

    // Act
    const withdrawal = createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(40),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });

    // Assert
    const withdrawn =
      bookingSession.participantList.requireParticipation("p-alice");
    expect(withdrawal.kind).toBe("REFUNDED");
    expect(
      withdrawal.instructions.map((instruction) => instruction.kind),
    ).toEqual(["REFUND"]);
    expect(withdrawn.replacementMode).toBe("DIRECT_INVITE");
    expect(withdrawn.replacementInviteeId).toBe("cara");
    expect(withdrawn.hold?.state).toBe("REFUNDED");
    expect(bookingSession.getAvailableSlots(at(40))).toBe(0);
  });

  test("withdraw_WhenParticipantAlreadyInvitedSomeone_RejectsSecondInvitation", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
    });
    const ben = createTestUser({ userId: "ben" }).asParticipant();
    ben.withdraw(bookingSession, {
      participationId: "p-ben",
      now: at(10),
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId: "cara",
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      ben.withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(9),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "dana",
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
    expect(
      bookingSession.participantList.personalReplacementForInvitee("cara")
        ?.replacementInviteeId,
    ).toBe("cara");
    expect(
      bookingSession.participantList.personalReplacementForInvitee("dana"),
    ).toBeUndefined();
    expect(bookingSession.participantList.reservedCount).toBe(1);
    expect(bookingSession.getAvailableSlots(at(9))).toBe(0);
  });

  test("withdraw_WhenNamedRecipientIsMissing_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: at(40),
          replacementMode: "DIRECT_INVITE",
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("withdraw_WhenParticipantInvitesThemself_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: at(10),
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "alice",
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("withdraw_WhenInviteeAlreadyHasACommittedSeat_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-alice",
          now: at(10),
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "ben",
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("withdraw_WhenInviteeAlreadyHasAnotherReservation_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["alice", "ben"],
    });
    createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-alice",
        now: at(10),
        replacementMode: "DIRECT_INVITE",
        replacementInviteeId: "cara",
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "ben" })
        .asParticipant()
        .withdraw(bookingSession, {
          participationId: "p-ben",
          now: at(9),
          replacementMode: "DIRECT_INVITE",
          replacementInviteeId: "cara",
        }),
    ).toThrow(expect.objectContaining({ code: "DUPLICATE_ID" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("withdraw_WhenExactlyAtRefundCutoff_AwaitsReplacement", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    // Act
    const withdrawal = createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(30) });

    // Assert
    expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("AWAITING_REPLACEMENT");
  });

  test("withdraw_WhenOneHourBeforeStart_AwaitsReplacement", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    // Act
    const withdrawal = createTestUser({ userId: "alice" })
      .asParticipant()
      .withdraw(bookingSession, { participationId: "p-alice", now: at(1) });

    // Assert
    expect(withdrawal.kind).toBe("AWAITING_REPLACEMENT");
    expect(
      bookingSession.participantList.requireParticipation("p-alice").hold
        ?.state,
    ).toBe("AWAITING_REPLACEMENT");
  });

  test("withdraw_WhenActorDoesNotOwnParticipation_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "other" })
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-alice", now: before }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("withdraw_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["alice"] });

    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "alice" })
        .asParticipant()
        .withdraw(bookingSession, { participationId: "p-alice", now: start }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
