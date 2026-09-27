import { Session } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  end,
  hour,
  createTestSession,
  sessionDetails,
  sessionState,
  verifiedParticipation,
} from "./session-fixtures";

describe("Session", () => {
  test("autoVerifyAttendance_WhenOneMillisecondBeforeDue_RejectsWithoutChangingState", () => {
    // Arrange
    const source = createTestSession({ committedUserIds: ["ben"] });
    const bookingSession = new Session(
      sessionDetails({
        participations: [
          verifiedParticipation("alice", "ABSENT"),
          ...source.participantList.participations,
        ],
      }),
    );
    const previousState = sessionState(bookingSession);

    // Act & Assert
    expect(() =>
      bookingSession.autoVerifyAttendance(
        new Date(end.getTime() + 72 * hour - 1),
      ),
    ).toThrow(expect.objectContaining({ code: "AUTO_VERIFICATION_NOT_DUE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("autoVerifyAttendance_WhenExactlySeventyTwoHoursAfterEnd_VerifiesOnlyRemainingParticipants", () => {
    // Arrange
    const source = createTestSession({ committedUserIds: ["ben"] });
    const bookingSession = new Session(
      sessionDetails({
        participations: [
          verifiedParticipation("alice", "ABSENT"),
          ...source.participantList.participations,
        ],
      }),
    );

    // Act
    bookingSession.autoVerifyAttendance(new Date(end.getTime() + 72 * hour));

    // Assert
    expect(
      bookingSession.participantList.participations.map((participation) => [
        participation.attendance,
        participation.verificationMethod,
      ]),
    ).toEqual([
      ["ABSENT", "BOOKER"],
      ["ATTENDED", "AUTOMATIC"],
    ]);
  });
});
