import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  createTestSession,
  readyBooker,
} from "../sessions/session/session-fixtures";

describe("Booker", () => {
  test("cancel_WhenOwnerCancelsEmptySession_ReturnsNoInstructions", () => {
    // Arrange
    const cancellationTime = hoursBeforeSessionStart(48);
    const booker = readyBooker();
    const session = createTestSession();

    // Act
    const cancellation = booker.cancel(session, cancellationTime);

    // Assert
    expect(session.bookerId).toBe(booker.userId);
    expect(session.status).toBe("CANCELLED");
    expect(cancellation.instructions).toEqual([]);
  });
});
