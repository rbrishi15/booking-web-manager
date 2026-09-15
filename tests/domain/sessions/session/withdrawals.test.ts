import { describe, expect, it } from "vitest";
import {
  at,
  before,
  captureError,
  destination,
  end,
  facts,
  hour,
  join,
  session,
  start,
} from "./session-fixtures";

describe("Session withdrawals and management", () => {
  it.each([
    [30 + 1 / hour, "REFUNDED"],
    [30, "AWAITING_REPLACEMENT"],
    [1, "AWAITING_REPLACEMENT"],
  ] as const)("enforces the strict 30-hour boundary (%s)", (hours, kind) => {
    // Arrange
    const s = session();
    join(s, "a");

    // Act
    const withdrawal = s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(hours),
    });

    // Assert
    expect(withdrawal.kind).toBe(kind);
    expect(s.participations[0]?.hold?.state).toBe(
      kind === "REFUNDED" ? "REFUNDED" : "AWAITING_REPLACEMENT",
    );
  });

  it("refunds the oldest withdrawal even when the entrant uses a newer withdrawal's link", () => {
    // Arrange
    const s = session();
    join(s, "a");
    join(s, "b");
    s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: at(20),
      replacementMode: "INVITE_LINK",
      replacementToken: "old",
    });
    s.withdrawParticipant({
      actorId: "b",
      participationId: "p-b",
      now: at(20),
      replacementMode: "INVITE_LINK",
      replacementToken: "new",
    });
    s.changeVisibility({
      actorId: "booker",
      visibility: "PRIVATE",
      now: at(19),
    });

    // Act
    const replacement = s.join({
      participationId: "p-c",
      holdId: "h-c",
      facts: facts("c"),
      replacementToken: "new",
      now: at(19),
    });

    // Assert
    expect(replacement.refundedParticipationId).toBe("p-a");
    expect(replacement.instructions.map((i) => i.kind)).toEqual([
      "LOCK",
      "REFUND",
    ]);
    expect(s.participations.find((p) => p.userId === "b")?.hold?.state).toBe(
      "AWAITING_REPLACEMENT",
    );
  });

  it("expires replacements at start, including a missed scheduler sweep during settlement", () => {
    // Arrange
    const s = session();
    join(s, "a");
    s.withdrawParticipant({ actorId: "a", participationId: "p-a", now: at(2) });

    // Act
    s.expireReplacements(at(1));
    const batch = s.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });

    // Assert
    expect(s.participations[0]?.hold?.state).toBe("FORFEITURE_DUE");
    expect(batch?.lines).toMatchObject([{ kind: "FORFEIT" }]);
  });

  it("checks ownership and pre-start cutoffs without partial changes", () => {
    // Arrange
    const s = session();
    join(s, "a");

    // Act
    const unauthorizedRemoval = () =>
      s.removeParticipant({
        actorId: "other",
        participationId: "p-a",
        now: before,
      });
    const unauthorizedWithdrawal = () =>
      s.withdrawParticipant({
        actorId: "other",
        participationId: "p-a",
        now: before,
      });
    const startedWithdrawal = () =>
      s.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: start,
      });
    const startedCancellation = () =>
      s.cancel({ actorId: "booker", now: start });
    const unauthorizedRemovalError = captureError(unauthorizedRemoval);
    const unauthorizedWithdrawalError = captureError(unauthorizedWithdrawal);
    const startedWithdrawalError = captureError(startedWithdrawal);
    const startedCancellationError = captureError(startedCancellation);
    const removed = s.removeParticipant({
      actorId: "booker",
      participationId: "p-a",
      now: before,
    });
    const rejoinRemoved = () => join(s, "a");

    // Assert
    expect(unauthorizedRemovalError).toEqual(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
    expect(unauthorizedWithdrawalError).toEqual(
      expect.objectContaining({ code: "UNAUTHORIZED" }),
    );
    expect(startedWithdrawalError).toEqual(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
    expect(startedCancellationError).toEqual(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
    expect(removed.instructions[0]?.kind).toBe("REFUND");
    expect(rejoinRemoved).toThrow(
      expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }),
    );
  });

  it("cancels with all active and awaiting funds refunded and waitlist cleared", () => {
    // Arrange
    const s = session();
    join(s, "a");
    join(s, "b");
    join(s, "c");
    s.withdrawParticipant({ actorId: "a", participationId: "p-a", now: at(2) });

    // Act
    const result = s.cancel({ actorId: "booker", now: at(1) });

    // Assert
    expect(result.instructions).toHaveLength(2);
    expect(result.instructions.every((i) => i.kind === "REFUND")).toBe(true);
    expect(s.status).toBe("CANCELLED");
    expect(s.nextWaitlistedUserId).toBeUndefined();
    expect(
      s.participations.every((p) => !p.hold || p.hold.state === "REFUNDED"),
    ).toBe(true);
  });
});
