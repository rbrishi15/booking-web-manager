import { describe, expect, test } from "vitest";
import { Session } from "@/domain";
import { createTestSession, hoursBeforeSessionStart, readyBooker, sessionDetails } from "../../sessions/session/session-fixtures";

describe("Booker", () => {
  test("cancel_WhenRosterHasRemovedParticipant_PreservesRemovalWithoutSecondRefund", () => {
    // Arrange
    const session = createTestSession({ committedUserIds: ["alice", "ben"], waitlistedUserIds: ["cara"] });
    const booker = readyBooker();
    booker.removeParticipant(session, "p-alice", hoursBeforeSessionStart(48));
    const removed = session.participantList.requireParticipation("p-alice");

    // Act
    const result = booker.cancel(session, hoursBeforeSessionStart(24));

    // Assert
    expect(session.status).toBe("CANCELLED");
    expect(session.participantList.requireParticipation("p-alice")).toBe(removed);
    expect(result.instructions.map((i) => [i.participationId, i.amount.toCents()])).toEqual([["p-ben", 500]]);
    expect(session.participantList.requireParticipation("p-cara").status).toBe("CANCELLED");
    expect(new Session(sessionDetails({
      status: "CANCELLED", participations: session.participantList.participations,
      nextQueueSequence: session.participantList.nextQueueSequence,
    })).participantList.requireParticipation("p-alice").status).toBe("REMOVED");
  });

  test("cancel_WhenRosterHasPreviouslyCancelledParticipant_PreservesTerminalHold", () => {
    // Arrange
    const original = createTestSession({ committedUserIds: ["alice"] });
    readyBooker().cancel(original, hoursBeforeSessionStart(48));
    const closed = original.participantList.requireParticipation("p-alice");
    const session = new Session(sessionDetails({ participations: [closed] }));

    // Act
    const result = readyBooker().cancel(session, hoursBeforeSessionStart(24));

    // Assert
    expect(session.participantList.requireParticipation("p-alice")).toBe(closed);
    expect(result.instructions).toEqual([]);
  });
});
