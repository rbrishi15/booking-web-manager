import {
  type AdmissionFacts,
  Booking,
  Money,
  ReliabilityScore,
  Session,
  type SessionDetails,
  type SessionCreation,
  Participation,
  DomainError,
} from "@/domain";
import { describe, expect, it, vi } from "vitest";

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
function creationDetails(totalSlots = 2): SessionCreation {
  return {
    sessionId: "s",
    bookerId: "booker",
    bookerStatus: "ACTIVE",
    payoutReady: true,
    booking: new Booking({
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
  };
}
function session(totalSlots = 2) {
  return Session.create(creationDetails(totalSlots));
}
function join(s: Session, id: string, now = before) {
  return s.join({
    participationId: `p-${id}`,
    holdId: `h-${id}`,
    facts: facts(id),
    now,
  });
}

function sessionDetails(
  overrides: Partial<SessionDetails> = {},
): SessionDetails {
  return {
    sessionId: "s",
    bookerId: "booker",
    booking: creationDetails().booking,
    totalSlots: 2,
    minimumHeadcount: 2,
    holdingAccountId: "platform",
    roomToken: "room",
    visibility: "PUBLIC",
    status: "OPEN",
    participations: [],
    nextQueueSequence: 1,
    payoutAttemptIds: [],
    payoutIdempotencyKeys: [],
    ...overrides,
  };
}
// Capture observable command effects as values, including nested private-field objects.
function sessionState(s: Session) {
  const batch = s.pendingSettlement;
  return {
    status: s.status,
    visibility: s.visibility,
    invitedGroupId: s.invitedGroupId,
    nextQueueSequence: s.nextQueueSequence,
    payoutAttemptIds: s.payoutAttemptIds,
    payoutIdempotencyKeys: s.payoutIdempotencyKeys,
    pendingSettlement: batch && {
      ...batch,
      lines: batch.lines.map((line) => ({
        ...line,
        amount: line.amount.toCents(),
      })),
    },
    participations: s.participations.map((p) => ({
      participationId: p.participationId,
      userId: p.userId,
      status: p.status,
      attendance: p.attendance,
      queueSequence: p.queueSequence,
      waitlistedAt: p.waitlistedAt,
      committedAt: p.committedAt,
      withdrawnAt: p.withdrawnAt,
      replacementMode: p.replacementMode,
      replacementToken: p.replacementToken,
      replacesParticipationId: p.replacesParticipationId,
      verifiedAt: p.verifiedAt,
      verificationMethod: p.verificationMethod,
      hold: p.hold && {
        holdId: p.hold.holdId,
        participationId: p.hold.participationId,
        holdingAccountId: p.hold.holdingAccountId,
        walletId: p.hold.walletId,
        amount: p.hold.amount.toCents(),
        state: p.hold.state,
        payoutId: p.hold.payoutId,
        createdAt: p.hold.createdAt,
        settledAt: p.hold.settledAt,
      },
    })),
  };
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
    const create = creationDetails();

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
      const prior = sessionState(s);
      const operation = () =>
        s.join({
          participationId: "p",
          holdId: "h",
          facts: facts("u", patch),
          now: before,
        });
      try {
        operation();
        return { code, error: undefined, prior, after: sessionState(s) };
      } catch (error) {
        return { code, error, prior, after: sessionState(s) };
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

  it("constructs existing state with domain children and isolates mutable inputs and getters", () => {
    const source = session();
    join(source, "a");
    const participations = [...source.participations];
    const attemptIds = ["earlier"];
    const keys = ["earlier-key"];
    const constructed = new Session(
      sessionDetails({
        participations,
        payoutAttemptIds: attemptIds,
        payoutIdempotencyKeys: keys,
      }),
    );
    const child = participations[0]!;
    participations.pop();
    attemptIds.push("leak");
    keys.push("leak");
    (constructed.participations as Participation[]).pop();
    (constructed.payoutAttemptIds as string[]).pop();
    (constructed.payoutIdempotencyKeys as string[]).pop();
    constructed.booking.startAt.setFullYear(2000);
    child.committedAt?.setFullYear(2000);
    child.hold?.createdAt.setFullYear(2000);
    expect(constructed.participations).toHaveLength(1);
    expect(constructed.participations[0]).toBe(child);
    expect(constructed.booking.startAt).toEqual(start);
    expect(child.committedAt).toEqual(before);
    expect(child.hold?.createdAt).toEqual(before);
    expect(constructed.payoutAttemptIds).toEqual(["earlier"]);
    expect(constructed.payoutIdempotencyKeys).toEqual(["earlier-key"]);
    expect(constructed.nextQueueSequence).toBe(1);
    expect(() => Session.create({ ...creationDetails(), now: end })).toThrow(
      expect.objectContaining({ code: "SESSION_STARTED" }),
    );
    const ended = new Session(sessionDetails({ status: "SETTLED" }));
    expect(ended.status).toBe("SETTLED");
    expect(ended.booking.endAt).toEqual(end);
  });

  it("constructors validate duplicate rosters, queue ordering, history, and lifecycle state", () => {
    const source = session();
    join(source, "a");
    const roster = source.participations;
    const queued = Participation.createWaitlisted({
      participationId: "queued",
      userId: "queued-user",
      waitlistedAt: before,
      queueSequence: 5,
    });
    const invalid: Partial<SessionDetails>[] = [
      { participations: [...roster, ...roster] },
      { status: "PAYOUT_PENDING" },
      { participations: [queued], nextQueueSequence: 5 },
      { participations: roster, status: "SETTLED" },
      { participations: roster, holdingAccountId: "foreign" },
      { payoutAttemptIds: ["same", "same"] },
      { payoutIdempotencyKeys: ["same", "same"] },
    ];
    for (const change of invalid)
      expect(() => new Session(sessionDetails(change))).toThrow(DomainError);
    expect(
      new Session(
        sessionDetails({ participations: [queued], nextQueueSequence: 6 }),
      ).nextWaitlistedUserId,
    ).toBe("queued-user");
  });

  it("constructs pending settlement state and protects batch, lines, destination, and history", () => {
    const source = session();
    join(source, "a");
    source.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    const batch = source.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    })!;
    const details = sessionDetails({
      status: "PAYOUT_PENDING",
      participations: source.participations,
      pendingSettlement: batch,
      payoutAttemptIds: source.payoutAttemptIds,
      payoutIdempotencyKeys: source.payoutIdempotencyKeys,
    });
    const constructed = new Session(details);
    expect(
      () =>
        new Session({
          ...details,
          pendingSettlement: { ...batch, sessionId: "foreign" },
        }),
    ).toThrow(DomainError);
    expect(
      () =>
        new Session({
          ...details,
          pendingSettlement: {
            ...batch,
            lines: [{ ...batch.lines[0]!, walletId: "foreign" }],
          },
        }),
    ).toThrow(DomainError);
    expect(() => new Session({ ...details, payoutAttemptIds: [] })).toThrow(
      DomainError,
    );
    expect(
      () => new Session({ ...details, payoutIdempotencyKeys: [] }),
    ).toThrow(DomainError);
    batch.requestedAt.setFullYear(2000);
    (
      batch.destination as { bankAccountReference: string }
    ).bankAccountReference = "changed";
    (batch.lines as unknown[]).pop();
    constructed.pendingSettlement?.requestedAt.setFullYear(2001);
    const exposed = constructed.pendingSettlement!;
    (
      exposed.destination as { bankAccountReference: string }
    ).bankAccountReference = "changed-again";
    (exposed.lines as unknown[]).pop();
    expect(constructed.pendingSettlement?.requestedAt).toEqual(end);
    expect(
      constructed.pendingSettlement?.destination.bankAccountReference,
    ).toBe("bank");
    expect(constructed.pendingSettlement?.lines).toHaveLength(1);
    expect(constructed.pendingSettlement?.lines[0]?.amount.toCents()).toBe(500);
    expect(constructed.payoutAttemptIds).toEqual(["out"]);
    expect(constructed.payoutIdempotencyKeys).toEqual(["key"]);
    expect(
      constructed
        .completeSettlement("out", end)
        .instructions.map((line) => line.kind),
    ).toEqual(["RELEASE"]);
    expect(constructed.status).toBe("SETTLED");
    expect(source.status).toBe("PAYOUT_PENDING");
    expect(source.participations[0]?.hold?.state).toBe("HELD");
  });

  it("failed settlement preparation leaves proposed expiry and payout history unapplied", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    s.withdrawParticipant({ actorId: "a", participationId: "p-a", now: at(2) });
    const command = {
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    };
    const initial = sessionState(s);
    expect(() => s.prepareSettlement(command)).toThrow(
      expect.objectContaining({ code: "ATTENDANCE_INCOMPLETE" }),
    );
    expect(sessionState(s)).toEqual(initial);
    expect(s.participations[0]?.hold?.state).toBe("AWAITING_REPLACEMENT");
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    const verified = sessionState(s);
    expect(() =>
      s.prepareSettlement({
        ...command,
        destination: { ...destination, userId: "foreign" },
      }),
    ).toThrow(DomainError);
    expect(sessionState(s)).toEqual(verified);
    expect(s.payoutAttemptIds).toEqual([]);
    expect(s.payoutIdempotencyKeys).toEqual([]);
    const batch = s.prepareSettlement(command);
    expect(batch?.lines.map((line) => line.kind)).toEqual([
      "FORFEIT",
      "RELEASE",
    ]);
    expect(s.participations[0]?.hold?.state).toBe("FORFEITURE_DUE");
    expect(s.payoutAttemptIds).toEqual(["out"]);
    expect(s.payoutIdempotencyKeys).toEqual(["key"]);
  });

  it("failed completion leaves all holds pending even after an earlier line was calculated", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    s.verifyAttendance({
      actorId: "booker",
      marks: [
        { participationId: "p-a", attendance: "ATTENDED" },
        { participationId: "p-b", attendance: "ATTENDED" },
      ],
      now: end,
    });
    s.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });
    const initial = sessionState(s);
    expect(() => s.completeSettlement("stale", end)).toThrow(
      expect.objectContaining({ code: "STALE_PAYOUT" }),
    );
    expect(() => s.completeSettlement("out", new Date(NaN))).toThrow(
      DomainError,
    );
    expect(sessionState(s)).toEqual(initial);
    const failure = vi
      .spyOn(s.participations[1]!, "settleHold")
      .mockImplementationOnce(() => {
        throw new DomainError("INVALID_STATE", "Second line rejected");
      });
    expect(() => s.completeSettlement("out", end)).toThrow(
      "Second line rejected",
    );
    failure.mockRestore();
    expect(sessionState(s)).toEqual(initial);
    expect(s.completeSettlement("out", end).instructions).toHaveLength(2);
    expect(s.participations.map((p) => p.hold?.state)).toEqual([
      "RELEASED",
      "RELEASED",
    ]);
    expect(s.pendingSettlement).toBeUndefined();
  });
});
