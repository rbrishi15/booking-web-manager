import { describe, expect, it } from "vitest";
import { Money } from "../../../domain/finance/money";
import { ReliabilityScore } from "../../../domain/reliability/reliability-score";
import { Booking } from "../../../domain/sessions/booking";
import { Session } from "../../../domain/sessions/session";
import type { AdmissionFacts } from "../../../domain/shared/operations";

const hour = 3_600_000;
const start = new Date("2026-10-10T10:00:00Z");
const end = new Date(start.getTime() + 2 * hour);
const before = new Date(start.getTime() - 48 * hour);
const at = (hoursBefore: number) =>
  new Date(start.getTime() - hoursBefore * hour);
const destination = {
  payoutAccountId: "pa",
  userId: "booker",
  providerAccountReference: "provider",
  bankAccountReference: "bank",
};
function facts(
  userId: string,
  patch: Partial<AdmissionFacts> = {},
): AdmissionFacts {
  return {
    userId,
    walletId: `w-${userId}`,
    accountStatus: "ACTIVE",
    availableBalance: Money.fromCents(10000),
    score: ReliabilityScore.from(100),
    memberGroupIds: [],
    ...patch,
  };
}
function session(totalSlots = 2) {
  return Session.create({
    sessionId: "s",
    bookerId: "booker",
    bookerStatus: "ACTIVE",
    payoutReady: true,
    booking: Booking.create({
      venueName: "Court",
      region: "North",
      sport: "Badminton",
      startAt: start,
      endAt: end,
      totalCost: Money.fromCents(1000),
    }),
    totalSlots,
    minimumHeadcount: 2,
    holdingAccountId: "platform",
    roomToken: "room",
    visibility: "PUBLIC",
    now: before,
  });
}
function join(s: Session, id: string, now = before) {
  return s.join({
    participationId: `p-${id}`,
    holdId: `h-${id}`,
    facts: facts(id),
    now,
  });
}
function captureError(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("Session admission and roster", () => {
  it("offers all eight places including an ordinary place for the booker", () => {
    // Arrange
    const s = session(8);

    // Act
    const commitments = ["booker", "a", "b", "c", "d", "e", "f", "g"].map(
      (id) => join(s, id).kind,
    );
    const availableSlots = s.getAvailableSlots(before);
    const waitingKind = join(s, "waiting").kind;

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
    expect(waitingKind).toBe("WAITLISTED");
  });
  it("validates creation and a positive per-slot share", () => {
    // Arrange
    const base = session().snapshot();
    const create = {
      ...base,
      booking: Booking.reconstitute(base.booking),
      bookerStatus: "ACTIVE" as const,
      payoutReady: true,
      now: before,
    };

    // Act
    const inactiveBooker = () =>
      Session.create({ ...create, bookerStatus: "INACTIVE" });
    const incompletePayout = () =>
      Session.create({ ...create, payoutReady: false });
    const tooManySlots = () => Session.create({ ...create, totalSlots: 1001 });
    const invalidHeadcount = () =>
      Session.create({ ...create, minimumHeadcount: 1 });

    // Assert
    expect(inactiveBooker).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
    expect(incompletePayout).toThrow(
      expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
    );
    expect(tooManySlots).toThrow();
    expect(invalidHeadcount).toThrow();
  });
  it("checks eligibility, access and balance before committing without changing state", () => {
    // Arrange
    const s = session();
    const rejectedAdmissions = [
      [{ accountStatus: "INACTIVE" }, "INACTIVE_ACCOUNT"],
      [{ availableBalance: Money.fromCents(499) }, "INSUFFICIENT_FUNDS"],
    ] as const;

    // Act
    const rejectedResults = rejectedAdmissions.map(([patch, code]) => {
      const prior = s.snapshot();
      const operation = () =>
        s.join({
          participationId: "p",
          holdId: "h",
          facts: facts("u", patch),
          now: before,
        });
      try {
        operation();
        return { code, error: undefined, prior, after: s.snapshot() };
      } catch (error) {
        return { code, error, prior, after: s.snapshot() };
      }
    });
    s.changeVisibility({
      actorId: "booker",
      visibility: "PRIVATE",
      now: before,
    });
    const privateJoin = () => join(s, "u");
    const admitted = s.join({
      participationId: "p",
      holdId: "h",
      facts: facts("u"),
      now: before,
      roomToken: "room",
    });

    // Assert
    expect(rejectedResults).toHaveLength(2);
    expect(rejectedResults[0]?.error).toEqual(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
    expect(rejectedResults[1]?.error).toEqual(
      expect.objectContaining({ code: "INSUFFICIENT_FUNDS" }),
    );
    expect(rejectedResults[0]?.after).toEqual(rejectedResults[0]?.prior);
    expect(rejectedResults[1]?.after).toEqual(rejectedResults[1]?.prior);
    expect(privateJoin).toThrow(
      expect.objectContaining({ code: "INVALID_ACCESS" }),
    );
    expect(admitted.kind).toBe("COMMITTED");
  });
  it("queues without locking money, preserves tie order, and gives existing waiters priority", () => {
    // Arrange
    const s = session();

    // Act
    join(s, "a");
    join(s, "b");
    const wait = s.join({
      participationId: "p-c",
      holdId: "h-c",
      facts: facts("c", { availableBalance: Money.fromCents(0) }),
      now: before,
    });
    join(s, "d");
    s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: before,
    });
    const fresh = join(s, "fresh");
    const firstPromotion = s.promoteNext({
      holdId: "h-c",
      facts: facts("c", { availableBalance: Money.fromCents(0) }),
      now: before,
    });
    const nextWaiterAfterSkip = s.nextWaitlistedUserId;
    const secondPromotion = s.promoteNext({
      holdId: "h-d",
      facts: facts("d"),
      now: before,
    });

    // Assert
    expect(wait).toMatchObject({ kind: "WAITLISTED", instructions: [] });
    expect(fresh.kind).toBe("WAITLISTED");
    expect(firstPromotion).toMatchObject({
      kind: "SKIPPED",
      reason: "INSUFFICIENT_FUNDS",
    });
    expect(nextWaiterAfterSkip).toBe("d");
    expect(secondPromotion.kind).toBe("PROMOTED");
    expect(s.nextWaitlistedUserId).toBe("fresh");
  });
  it("allows waitlist re-entry with the same ID and a fresh queue position", () => {
    // Arrange
    const s = session();
    join(s, "a");
    join(s, "b");
    join(s, "c");
    join(s, "d");

    // Act
    s.leaveWaitlist({ actorId: "c", participationId: "p-c", now: before });
    const differentId = () =>
      s.join({
        participationId: "different",
        holdId: "h-c",
        facts: facts("c"),
        now: before,
      });
    const differentIdError = captureError(differentId);
    const reentry = join(s, "c");

    // Assert
    expect(differentIdError).toEqual(
      expect.objectContaining({ code: "DUPLICATE_ID" }),
    );
    expect(reentry.kind).toBe("WAITLISTED");
    expect(s.nextWaitlistedUserId).toBe("d");
    expect(s.participations.filter((p) => p.userId === "c")).toHaveLength(1);
  });
  it("rejects duplicates, rejoining after withdrawal, and joins at session start", () => {
    // Arrange
    const s = session();
    join(s, "a");

    // Act
    const duplicate = captureError(() => join(s, "a"));
    s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: before,
    });
    const rejoinAfterWithdrawal = () => join(s, "a");
    const joinAtStart = () => join(s, "b", start);
    const availableAtStart = s.getAvailableSlots(start);

    // Assert
    expect(duplicate).toEqual(
      expect.objectContaining({ code: "ALREADY_PARTICIPATING" }),
    );
    expect(rejoinAfterWithdrawal).toThrow(
      expect.objectContaining({ code: "REJOIN_NOT_ALLOWED" }),
    );
    expect(joinAtStart).toThrow(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
    expect(availableAtStart).toBe(0);
  });
});

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

describe("Session attendance and external settlement", () => {
  it("requires completed attendance and rejects conflicting marks atomically", () => {
    // Arrange
    const s = session();
    join(s, "a");
    join(s, "b");

    // Act
    const beforePrematureVerification = s.snapshot();
    const prematureVerification = captureError(() =>
      s.verifyAttendance({
        actorId: "booker",
        marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
        now: at(-1),
      }),
    );
    const afterPrematureVerification = s.snapshot();
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const beforeIncompleteSettlement = s.snapshot();
    const incompleteSettlement = captureError(() =>
      s.prepareSettlement({
        actorId: "booker",
        payoutId: "out",
        idempotencyKey: "key",
        destination,
        now: end,
      }),
    );
    const afterIncompleteSettlement = s.snapshot();
    const beforeConflictingVerification = s.snapshot();
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
    const afterConflictingVerification = s.snapshot();
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
    const beforeDue = s.snapshot();

    // Act
    const notDue = captureError(() =>
      s.autoVerifyAttendance(new Date(end.getTime() + 72 * hour - 1)),
    );
    const afterNotDue = s.snapshot();
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
  it("restores validated snapshots and protects collection, dates, children, and pending batch", () => {
    // Arrange
    const s = session();
    join(s, "a");
    const prior = s.snapshot();

    // Act
    s.booking.startAt.setFullYear(2000);
    const protectedSnapshot = s.snapshot();
    const restored = Session.reconstitute(prior);
    const duplicateRoster = () =>
      Session.reconstitute({
        ...prior,
        participations: [...prior.participations, ...prior.participations],
      });
    const inconsistentStatus = () =>
      Session.reconstitute({ ...prior, status: "PAYOUT_PENDING" });
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const batch = s.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });
    if (batch) batch.requestedAt.setFullYear(2000);
    const afterRestore = Session.reconstitute(s.snapshot()).snapshot();
    const pendingRequestedAt = s.snapshot().pendingSettlement?.requestedAt;

    // Assert
    expect(protectedSnapshot).toEqual(prior);
    expect(restored.snapshot()).toEqual(prior);
    expect(duplicateRoster).toThrow();
    expect(inconsistentStatus).toThrow();
    expect(afterRestore).toEqual(s.snapshot());
    expect(pendingRequestedAt).toEqual(end);
  });
});
