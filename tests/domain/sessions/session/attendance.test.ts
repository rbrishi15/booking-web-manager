import { describe, expect, it } from "vitest";
import {
  at,
  captureError,
  destination,
  end,
  hour,
  join,
  session,
  sessionState,
} from "./session-fixtures";

describe("Session attendance", () => {
  it("requires completed attendance and rejects conflicting marks atomically", () => {
    // Arrange
    const s = session();
    join(s, "a");
    join(s, "b");

    // Act
    const beforePrematureVerification = sessionState(s);
    const prematureVerification = captureError(() =>
      s.verifyAttendance({
        actorId: "booker",
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: at(-1),
      }),
    );
    const afterPrematureVerification = sessionState(s);
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const beforeIncompleteSettlement = sessionState(s);
    const incompleteSettlement = captureError(() =>
      s.prepareSettlement({
        actorId: "booker",
        payoutId: "out",
        idempotencyKey: "key",
        destination,
        now: end,
      }),
    );
    const afterIncompleteSettlement = sessionState(s);
    const beforeConflictingVerification = sessionState(s);
    const conflictingVerification = captureError(() =>
      s.verifyAttendance({
        actorId: "booker",
        marks: [
          { participationId: "p-b", attendance: "ATTENDED" },
          { participationId: "p-a", attendance: "ABSENT" },
        ],
        now: end,
      }),
    );
    const afterConflictingVerification = sessionState(s);
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ABSENT" }],
      now: end,
    });

    // Assert
    expect(prematureVerification).toEqual(
      expect.objectContaining({ code: "SESSION_NOT_ENDED" }),
    );
    expect(afterPrematureVerification).toEqual(beforePrematureVerification);
    expect(incompleteSettlement).toEqual(
      expect.objectContaining({ code: "ATTENDANCE_INCOMPLETE" }),
    );
    expect(afterIncompleteSettlement).toEqual(beforeIncompleteSettlement);
    expect(conflictingVerification).toEqual(
      expect.objectContaining({ code: "ATTENDANCE_CONFLICT" }),
    );
    expect(afterConflictingVerification).toEqual(beforeConflictingVerification);
    expect(s.status).toBe("AWAITING_PAYOUT");
  });

  it("auto-verifies only remaining participants at exactly 72 hours after end", () => {
    // Arrange
    const s = session();
    join(s, "a");
    join(s, "b");
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ABSENT" }],
      now: end,
    });
    const beforeDue = sessionState(s);

    // Act
    const notDue = captureError(() =>
      s.autoVerifyAttendance(new Date(end.getTime() + 72 * hour - 1)),
    );
    const afterNotDue = sessionState(s);
    s.autoVerifyAttendance(new Date(end.getTime() + 72 * hour));
    const attendance = s.participations.map((p) => [
      p.attendance,
      p.verificationMethod,
    ]);

    // Assert
    expect(notDue).toEqual(
      expect.objectContaining({ code: "AUTO_VERIFICATION_NOT_DUE" }),
    );
    expect(afterNotDue).toEqual(beforeDue);
    expect(attendance).toEqual([
      ["ABSENT", "BOOKER"],
      ["ATTENDED", "AUTOMATIC"],
    ]);
  });
});
