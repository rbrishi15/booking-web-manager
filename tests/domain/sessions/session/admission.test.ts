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
    test("recordAdmission_WhenBookerTakesEighthSlot_FillsSession", () => {
      // Arrange
      const bookingSession = createTestSession({
        totalSlots: 8,
        committedUserIds: [
          "alice",
          "ben",
          "cara",
          "dana",
          "evan",
          "farah",
          "grace",
        ],
      });
      const bookerAdmission = committedParticipation(bookingSession, "booker");

      // Act
      bookingSession.recordAdmission(bookerAdmission, undefined, before);

      // Assert
      expect(bookingSession.participantList.findByUserId("booker")).toBe(
        bookerAdmission,
      );
      expect(
        bookingSession.participantList.participations.map(
          (entry) => entry.status,
        ),
      ).toEqual([
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
        "COMMITTED",
      ]);
      expect(bookingSession.getAvailableSlots(before)).toBe(0);
    });

    test("recordAdmission_WhenSessionIsFull_RecordsWaitlistedParticipation", () => {
      // Arrange
      const bookingSession = createTestSession({
        totalSlots: 8,
        committedUserIds: [
          "booker",
          "alice",
          "ben",
          "cara",
          "dana",
          "evan",
          "farah",
          "grace",
        ],
      });
      const waiting = Participation.createWaitlisted({
        participationId: "p-waiting",
        userId: "waiting",
        waitlistedAt: before,
        queueSequence: 1,
      });

      // Act
      bookingSession.recordAdmission(waiting, undefined, before);

      // Assert
      expect(
        bookingSession.participantList.requireParticipation("p-waiting"),
      ).toBe(waiting);
      expect(bookingSession.participantList.nextWaitlisted()).toBe(waiting);
      expect(bookingSession.participantList.committedCount).toBe(8);
      expect(bookingSession.participantList.nextQueueSequence).toBe(2);
      expect(bookingSession.getAvailableSlots(before)).toBe(0);
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
