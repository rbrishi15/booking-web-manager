import { describe, expect, it } from "vitest";
import { Money } from "../finance/money";
import { ReliabilityScore } from "../reliability/reliability-score";
import type { AdmissionFacts } from "../shared/operations";
import { Booking } from "./booking";
import { Session } from "./session";

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
function expectRejectedUnchanged(s: Session, run: () => unknown, code: string) {
  const prior = s.snapshot();
  expect(run).toThrow(expect.objectContaining({ code }));
  expect(s.snapshot()).toEqual(prior);
}

describe("Session admission and roster", () => {
  it("offers all eight places including an ordinary place for the booker", () => {
    const s = session(8);
    for (const id of ["booker", "a", "b", "c", "d", "e", "f", "g"])
      expect(join(s, id).kind).toBe("COMMITTED");
    expect(s.getAvailableSlots(before)).toBe(0);
    expect(join(s, "waiting").kind).toBe("WAITLISTED");
  });
  it("validates creation and a positive per-slot share", () => {
    const base = session().snapshot();
    const create = {
      ...base,
      booking: Booking.reconstitute(base.booking),
      bookerStatus: "ACTIVE" as const,
      payoutReady: true,
      now: before,
    };
    expect(() =>
      Session.create({ ...create, bookerStatus: "INACTIVE" }),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    expect(() => Session.create({ ...create, payoutReady: false })).toThrow(
      expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
    );
    expect(() => Session.create({ ...create, totalSlots: 1001 })).toThrow();
    expect(() => Session.create({ ...create, minimumHeadcount: 1 })).toThrow();
  });
  it("checks eligibility, access and balance before committing without changing state", () => {
    const s = session();
    for (const [patch, code] of [
      [{ accountStatus: "INACTIVE" }, "INACTIVE_ACCOUNT"],
      [{ availableBalance: Money.fromCents(499) }, "INSUFFICIENT_FUNDS"],
    ] as const) {
      expectRejectedUnchanged(
        s,
        () =>
          s.join({
            participationId: "p",
            holdId: "h",
            facts: facts("u", patch),
            now: before,
          }),
        code,
      );
    }
    s.changeVisibility({
      actorId: "booker",
      visibility: "PRIVATE",
      now: before,
    });
    expectRejectedUnchanged(s, () => join(s, "u"), "INVALID_ACCESS");
    expect(
      s.join({
        participationId: "p",
        holdId: "h",
        facts: facts("u"),
        now: before,
        roomToken: "room",
      }).kind,
    ).toBe("COMMITTED");
  });
  it("queues without locking money, preserves tie order, and gives existing waiters priority", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    const wait = s.join({
      participationId: "p-c",
      holdId: "h-c",
      facts: facts("c", { availableBalance: Money.fromCents(0) }),
      now: before,
    });
    expect(wait).toMatchObject({ kind: "WAITLISTED", instructions: [] });
    join(s, "d");
    s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: before,
    });
    expect(join(s, "fresh").kind).toBe("WAITLISTED");
    expect(s.nextWaitlistedUserId).toBe("c");
    expect(
      s.promoteNext({
        holdId: "h-c",
        facts: facts("c", { availableBalance: Money.fromCents(0) }),
        now: before,
      }),
    ).toMatchObject({ kind: "SKIPPED", reason: "INSUFFICIENT_FUNDS" });
    expect(s.nextWaitlistedUserId).toBe("d");
    expect(
      s.promoteNext({ holdId: "h-d", facts: facts("d"), now: before }).kind,
    ).toBe("PROMOTED");
  });
  it("allows waitlist re-entry with the same ID and a fresh queue position", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    join(s, "c");
    join(s, "d");
    s.leaveWaitlist({ actorId: "c", participationId: "p-c", now: before });
    expectRejectedUnchanged(
      s,
      () =>
        s.join({
          participationId: "different",
          holdId: "h-c",
          facts: facts("c"),
          now: before,
        }),
      "DUPLICATE_ID",
    );
    join(s, "c");
    expect(s.nextWaitlistedUserId).toBe("d");
    expect(s.participations.filter((p) => p.userId === "c")).toHaveLength(1);
  });
  it("rejects duplicates, rejoining after withdrawal, and joins at session start", () => {
    const s = session();
    join(s, "a");
    expectRejectedUnchanged(s, () => join(s, "a"), "ALREADY_PARTICIPATING");
    s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: before,
    });
    expectRejectedUnchanged(s, () => join(s, "a"), "REJOIN_NOT_ALLOWED");
    expectRejectedUnchanged(s, () => join(s, "b", start), "SESSION_STARTED");
    expect(s.getAvailableSlots(start)).toBe(0);
  });
});

describe("Session withdrawals and management", () => {
  it.each([
    [30 + 1 / hour, "REFUNDED"],
    [30, "AWAITING_REPLACEMENT"],
    [1, "AWAITING_REPLACEMENT"],
  ] as const)("enforces the strict 30-hour boundary (%s)", (hours, kind) => {
    const s = session();
    join(s, "a");
    expect(
      s.withdrawParticipant({
        actorId: "a",
        participationId: "p-a",
        now: at(hours),
      }).kind,
    ).toBe(kind);
    expect(s.participations[0]?.hold?.state).toBe(
      kind === "REFUNDED" ? "REFUNDED" : "AWAITING_REPLACEMENT",
    );
  });
  it("refunds the oldest withdrawal even when the entrant uses a newer withdrawal's link", () => {
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
    const replacement = s.join({
      participationId: "p-c",
      holdId: "h-c",
      facts: facts("c"),
      replacementToken: "new",
      now: at(19),
    });
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
    const s = session();
    join(s, "a");
    s.withdrawParticipant({ actorId: "a", participationId: "p-a", now: at(2) });
    s.expireReplacements(at(1));
    expect(s.participations[0]?.hold?.state).toBe("AWAITING_REPLACEMENT");
    const batch = s.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });
    expect(batch?.lines).toMatchObject([{ kind: "FORFEIT" }]);
    expect(s.participations[0]?.hold?.state).toBe("FORFEITURE_DUE");
  });
  it("checks ownership and pre-start cutoffs without partial changes", () => {
    const s = session();
    join(s, "a");
    expectRejectedUnchanged(
      s,
      () =>
        s.removeParticipant({
          actorId: "other",
          participationId: "p-a",
          now: before,
        }),
      "UNAUTHORIZED",
    );
    expectRejectedUnchanged(
      s,
      () =>
        s.withdrawParticipant({
          actorId: "other",
          participationId: "p-a",
          now: before,
        }),
      "UNAUTHORIZED",
    );
    expectRejectedUnchanged(
      s,
      () =>
        s.withdrawParticipant({
          actorId: "a",
          participationId: "p-a",
          now: start,
        }),
      "SESSION_STARTED",
    );
    expectRejectedUnchanged(
      s,
      () => s.cancel({ actorId: "booker", now: start }),
      "SESSION_STARTED",
    );
    expect(
      s.removeParticipant({
        actorId: "booker",
        participationId: "p-a",
        now: before,
      }).instructions[0]?.kind,
    ).toBe("REFUND");
    expectRejectedUnchanged(s, () => join(s, "a"), "REJOIN_NOT_ALLOWED");
  });
  it("cancels with all active and awaiting funds refunded and waitlist cleared", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    join(s, "c");
    s.withdrawParticipant({ actorId: "a", participationId: "p-a", now: at(2) });
    const result = s.cancel({ actorId: "booker", now: at(1) });
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
    const s = session();
    join(s, "a");
    join(s, "b");
    expectRejectedUnchanged(
      s,
      () =>
        s.verifyAttendance({
          actorId: "booker",
          marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
          now: at(-1),
        }),
      "SESSION_NOT_ENDED",
    );
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ATTENDED" }],
      now: end,
    });
    expectRejectedUnchanged(
      s,
      () =>
        s.prepareSettlement({
          actorId: "booker",
          payoutId: "out",
          idempotencyKey: "key",
          destination,
          now: end,
        }),
      "ATTENDANCE_INCOMPLETE",
    );
    expectRejectedUnchanged(
      s,
      () =>
        s.verifyAttendance({
          actorId: "booker",
          marks: [
            { participationId: "p-b", attendance: "ATTENDED" },
            { participationId: "p-a", attendance: "ABSENT" },
          ],
          now: end,
        }),
      "ATTENDANCE_CONFLICT",
    );
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ABSENT" }],
      now: end,
    });
    expect(s.status).toBe("AWAITING_PAYOUT");
  });
  it("auto-verifies only remaining participants at exactly 72 hours after end", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-a", attendance: "ABSENT" }],
      now: end,
    });
    expectRejectedUnchanged(
      s,
      () => s.autoVerifyAttendance(new Date(end.getTime() + 72 * hour - 1)),
      "AUTO_VERIFICATION_NOT_DUE",
    );
    s.autoVerifyAttendance(new Date(end.getTime() + 72 * hour));
    expect(
      s.participations.map((p) => [p.attendance, p.verificationMethod]),
    ).toEqual([
      ["ABSENT", "BOOKER"],
      ["ATTENDED", "AUTOMATIC"],
    ]);
  });
  it("keeps money held during payout, retries failure with new identity, and finalizes externally", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    s.withdrawParticipant({ actorId: "a", participationId: "p-a", now: at(2) });
    s.verifyAttendance({
      actorId: "booker",
      marks: [{ participationId: "p-b", attendance: "ATTENDED" }],
      now: end,
    });
    const batch = s.prepareSettlement({
      actorId: "booker",
      payoutId: "out",
      idempotencyKey: "key",
      destination,
      now: end,
    });
    expect(s.status).toBe("PAYOUT_PENDING");
    expect(batch?.lines.map((l) => l.kind)).toEqual(["FORFEIT", "RELEASE"]);
    expect(s.participations.map((p) => p.hold?.state)).toEqual([
      "FORFEITURE_DUE",
      "HELD",
    ]);
    expectRejectedUnchanged(
      s,
      () =>
        s.prepareSettlement({
          actorId: "booker",
          payoutId: "another",
          idempotencyKey: "key2",
          destination,
          now: end,
        }),
      "PAYOUT_IN_PROGRESS",
    );
    expectRejectedUnchanged(
      s,
      () => s.completeSettlement("stale", end),
      "STALE_PAYOUT",
    );
    s.failSettlement("out", end);
    expect(s.status).toBe("AWAITING_PAYOUT");
    expectRejectedUnchanged(
      s,
      () =>
        s.prepareSettlement({
          actorId: "booker",
          payoutId: "out",
          idempotencyKey: "new",
          destination,
          now: end,
        }),
      "DUPLICATE_ID",
    );
    s.prepareSettlement({
      actorId: "booker",
      payoutId: "retry",
      idempotencyKey: "retry-key",
      destination,
      now: end,
    });
    expect(
      s.completeSettlement("retry", end).instructions.map((i) => i.kind),
    ).toEqual(["FORFEIT", "RELEASE"]);
    expect(s.status).toBe("SETTLED");
    expect(s.participations.map((p) => p.hold?.state)).toEqual([
      "FORFEITED",
      "RELEASED",
    ]);
    expect(s.participations[0]?.reliabilityOutcome(end)?.value).toBe(0);
  });
  it("settles empty sessions without a zero-value payout", () => {
    const s = session();
    expect(
      s.prepareSettlement({
        actorId: "booker",
        payoutId: "unused",
        idempotencyKey: "unused",
        destination,
        now: end,
      }),
    ).toBeUndefined();
    expect(s.status).toBe("SETTLED");
  });
  it("restores validated snapshots and protects collection, dates, children, and pending batch", () => {
    const s = session();
    join(s, "a");
    const prior = s.snapshot();
    s.booking.startAt.setFullYear(2000);
    expect(s.snapshot()).toEqual(prior);
    const restored = Session.reconstitute(prior);
    expect(restored.snapshot()).toEqual(prior);
    expect(() =>
      Session.reconstitute({
        ...prior,
        participations: [...prior.participations, ...prior.participations],
      }),
    ).toThrow();
    expect(() =>
      Session.reconstitute({ ...prior, status: "PAYOUT_PENDING" }),
    ).toThrow();
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
    expect(Session.reconstitute(s.snapshot()).snapshot()).toEqual(s.snapshot());
    expect(s.snapshot().pendingSettlement?.requestedAt).toEqual(end);
  });
});
