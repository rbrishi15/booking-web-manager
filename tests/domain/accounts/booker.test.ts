import { describe, expect, test } from "vitest";
import {
  before,
  createTestSession,
  readyBooker,
} from "../sessions/session/session-fixtures";

describe("Booker", () => {
  test("cancel_WhenOwnerCancelsEmptySession_ReturnsNoInstructions", () => {
    // Arrange
    const booker = readyBooker();
    const session = createTestSession();

    // Act
    const cancellation = booker.cancel(session, before);

    // Assert
    expect(session.bookerId).toBe(booker.userId);
    expect(session.status).toBe("CANCELLED");
    expect(cancellation.instructions).toEqual([]);
  });
});
