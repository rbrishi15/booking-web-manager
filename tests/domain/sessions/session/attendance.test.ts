import { Session } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  hoursAfterSessionEnd,
  createTestSession,
  sessionDetails,
  sessionState,
  verifiedParticipation,
} from "./session-fixtures";

describe("Session", () => {
  test("autoVerifyAttendance_WhenOneMillisecondBeforeDue_RejectsWithoutChangingState", () => {
    // Arrange
    const automaticVerificationDueAt = hoursAfterSessionEnd(72);
    const oneMillisecondBeforeAutomaticVerification = new Date(
      automaticVerificationDueAt.getTime() - 1,
    );
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
        oneMillisecondBeforeAutomaticVerification,
      ),
    ).toThrow(expect.objectContaining({ code: "AUTO_VERIFICATION_NOT_DUE" }));
    expect(sessionState(bookingSession)).toEqual(previousState);
  });

  test("autoVerifyAttendance_WhenExactlySeventyTwoHoursAfterEnd_VerifiesOnlyRemainingParticipants", () => {
    // Arrange
    const automaticVerificationDueAt = hoursAfterSessionEnd(72);
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
    bookingSession.autoVerifyAttendance(automaticVerificationDueAt);

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
