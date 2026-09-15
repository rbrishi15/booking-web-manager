import { describe, expect, it } from "vitest";
import {
  at,
  captureError,
  destination,
  end,
  join,
  session,
} from "./session-fixtures";

describe("Session external settlement", () => {
  it("keeps money held during payout, retries failure with new identity, and finalizes externally", () => {
    // Arrange
    const s = session();
    join(s, "a");
    join(s, "b");
    s.withdrawParticipant({ actorId: "a", participationId: "p-a", now: at(2) });
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });

    // Act
    const batch = s.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });
    const pendingStatus = s.status;
    const pendingKinds = batch?.lines.map((line) => line.kind);
    const pendingHoldStates = s.participations.map((p) => p.hold?.state);
    const inProgress = captureError(() =>
      s.prepareSettlement({
        actorId: "booker",
        payoutId: "another",
        idempotencyKey: "key2",
        destination,
        now: end,
      }),
    );
    const staleCompletion = captureError(() =>
      s.completeSettlement("stale", end),
    );
    s.failSettlement("out", end);
    const afterFailure = s.status;
    const duplicatePayout = captureError(() =>
      s.prepareSettlement({
        actorId: "booker",
        payoutId: "out",
        idempotencyKey: "new",
        destination,
        now: end,
      }),
    );
    const retryBatch = s.prepareSettlement({
      actorId: "booker",
      payoutId: "retry",
      idempotencyKey: "retry-key",
      destination,
      now: end,
    });
    const completed = s.completeSettlement("retry", end);
    const finalStatus = s.status;
    const finalHoldStates = s.participations.map((p) => p.hold?.state);
    const reliabilityOutcome =
      s.participations[0]?.reliabilityOutcome(end)?.value;

    // Assert
    expect(pendingStatus).toBe("PAYOUT_PENDING");
    expect(pendingKinds).toEqual(["FORFEIT", "RELEASE"]);
    expect(pendingHoldStates).toEqual(["FORFEITURE_DUE", "HELD"]);
    expect(inProgress).toEqual(
      expect.objectContaining({ code: "PAYOUT_IN_PROGRESS" }),
    );
    expect(staleCompletion).toEqual(
      expect.objectContaining({ code: "STALE_PAYOUT" }),
    );
    expect(afterFailure).toBe("AWAITING_PAYOUT");
    expect(duplicatePayout).toEqual(
      expect.objectContaining({ code: "DUPLICATE_ID" }),
    );
    expect(retryBatch?.payoutId).toBe("retry");
    expect(
      completed.instructions.map((instruction) => instruction.kind),
    ).toEqual(["FORFEIT", "RELEASE"]);
    expect(finalStatus).toBe("SETTLED");
    expect(finalHoldStates).toEqual(["FORFEITED", "RELEASED"]);
    expect(reliabilityOutcome).toBe(0);
  });

  it("settles empty sessions without a zero-value payout", () => {
    // Arrange
    const s = session();

    // Act
    const batch = s.prepareSettlement({
      actorId: "booker",
      payoutId: "unused",
      idempotencyKey: "unused",
      destination,
      now: end,
    });
    const status = s.status;

    // Assert
    expect(batch).toBeUndefined();
    expect(status).toBe("SETTLED");
  });
});
