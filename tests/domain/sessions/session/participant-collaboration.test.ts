import { describe, expect, test } from "vitest";
import { fundedWallet } from "../../accounts/user-fixtures";
import {
  at,
  before,
  join,
  loadedUser,
  readyBooker,
  session,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session", () => {
  test("admitParticipant_WhenSessionStartsNow_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    const participant = loadedUser("a").asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.admitParticipant(participant, {
        participationId: "p-a",
        holdId: "h-a",
        now: start,
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_STARTED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("admitParticipant_WhenParticipantCannotFundShare_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    const participant = loadedUser("a", {
      wallet: fundedWallet("a", 499),
    }).asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.admitParticipant(participant, {
        participationId: "p-a",
        holdId: "h-a",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("applyParticipantWithdrawal_WhenEntryBelongsToAnotherParticipant_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    const participant = loadedUser("other").asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.applyParticipantWithdrawal(participant, {
        participationId: "p-a",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("removeWaitlistedParticipant_WhenSessionIsCancelled_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    join(bookingSession, "b");
    join(bookingSession, "waiting");
    readyBooker().cancel(bookingSession, before);
    const participant = loadedUser("waiting").asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.removeWaitlistedParticipant(participant, {
        participationId: "p-waiting",
      }),
    ).toThrow(expect.objectContaining({ code: "SESSION_CLOSED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("releaseParticipantReplacement_WhenEntryBelongsToAnotherParticipant_RejectsWithoutChangingState", () => {
    // Arrange
    const bookingSession = session();
    join(bookingSession, "a");
    loadedUser("a")
      .asParticipant()
      .withdraw(bookingSession, {
        participationId: "p-a",
        now: at(10),
        replacementMode: "INVITE_LINK",
        replacementToken: "a-replacement",
      });
    const participant = loadedUser("other").asParticipant();
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.releaseParticipantReplacement(participant, {
        participationId: "p-a",
        now: at(9),
      }),
    ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });
});
