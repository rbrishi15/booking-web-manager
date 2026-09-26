import { Participation } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  before,
  committedParticipation,
  createTestSession,
  start,
} from "./session-fixtures";

describe("Session", () => {
  describe("Capacity", () => {
    test("recordAdmission_WhenEightSlotsFillIncludingBooker_RecordsNextApplicantOnWaitlist", () => {
      // Arrange
      const bookingSession = createTestSession({ totalSlots: 8 });

      // Act
      for (const id of [
        "booker",
        "alice",
        "ben",
        "cara",
        "dana",
        "evan",
        "farah",
        "grace",
      ]) {
        bookingSession.recordAdmission(
          committedParticipation(bookingSession, id),
          undefined,
          before,
        );
      }
      const commitments = bookingSession.participantList.participations.map(
        (entry) => entry.status,
      );
      const availableSlots = bookingSession.getAvailableSlots(before);
      bookingSession.recordAdmission(
        Participation.createWaitlisted({
          participationId: "p-waiting",
          userId: "waiting",
          waitlistedAt: before,
          queueSequence: bookingSession.participantList.nextQueueSequence,
        }),
        undefined,
        before,
      );
      const waitingStatus =
        bookingSession.participantList.participations.at(-1)?.status;

      // Assert
      expect(commitments).toEqual([
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
      ]);
      expect(availableSlots).toBe(0);
      expect(waitingStatus).toBe("WAITLISTED");
    });
  });

  describe("Availability", () => {
    test("getAvailableSlots_WhenSessionStartsNow_ReturnsZero", () => {
      // Arrange
      const bookingSession = createTestSession();

      // Act
      const availableSlots = bookingSession.getAvailableSlots(start);

      // Assert
      expect(availableSlots).toBe(0);
    });
  });
});
