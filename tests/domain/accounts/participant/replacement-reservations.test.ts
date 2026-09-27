import { describe, expect, test } from "vitest";
import {
  at,
  createTestUser,
  createTestSession,
  sessionState,
  start,
} from "../../sessions/session/session-fixtures";

describe("Participant", () => {
  test("offerPlaceToWaitlist_WhenOwnerReleasesPersonalPlace_OpensPlaceWithoutRefunding", () => {
    // Arrange
    const bookingSession = createTestSession({
      committedUserIds: ["ben", "alex"],
      waitlistedUserIds: ["dana", "evan"],
    });
    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    const heldShare =
      bookingSession.participantList.requireParticipation("p-ben").hold;
    const queueSequence = bookingSession.participantList.nextQueueSequence;

    // Act
    const offer = createTestUser({ userId: "ben" })
      .asParticipant()
      .offerPlaceToWaitlist(bookingSession, {
        participationId: "p-ben",
        now: at(9),
      });

    // Assert
    expect(offer.instructions).toEqual([]);
    expect(
      bookingSession.participantList.requireParticipation("p-ben").status,
    ).toBe("WITHDRAWN");
    expect(
      bookingSession.participantList.requireParticipation("p-ben")
        .replacementMode,
    ).toBe("OPEN_SLOT");
    expect(
      bookingSession.participantList.requireParticipation("p-ben")
        .replacementToken,
    ).toBeUndefined();
    expect(
      bookingSession.participantList.requireParticipation("p-ben").withdrawnAt,
    ).toEqual(at(10));
    expect(
      bookingSession.participantList.requireParticipation("p-ben").hold,
    ).toBe(heldShare);
    expect(heldShare?.state).toBe("AWAITING_REPLACEMENT");
    expect(bookingSession.participantList.nextWaitlisted()?.userId).toBe(
      "dana",
    );
    expect(bookingSession.participantList.nextQueueSequence).toBe(
      queueSequence,
    );
  });

  test("offerPlaceToWaitlist_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });

    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "booker" })
        .asParticipant()
        .offerPlaceToWaitlist(bookingSession, {
          participationId: "p-ben",
          now: at(9),
        }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("offerPlaceToWaitlist_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });

    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "ben" })
        .asParticipant()
        .offerPlaceToWaitlist(bookingSession, {
          participationId: "p-ben",
          now: start,
        }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("offerPlaceToWaitlist_WhenPersonalReplacementAlreadyJoined_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = createTestSession({ committedUserIds: ["ben"] });

    createTestUser({ userId: "ben" })
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-ben",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "ben-replacement",
      });
    createTestUser({ userId: "cara" })
      .asParticipant()
      .join(bookingSession, {
        participationId: "p-cara",
        holdId: "h-cara",
        replacementToken: "ben-replacement",
        now: at(9),
      });
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      createTestUser({ userId: "ben" })
        .asParticipant()
        .offerPlaceToWaitlist(bookingSession, {
          participationId: "p-ben",
          now: at(8),
        }),
    ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
