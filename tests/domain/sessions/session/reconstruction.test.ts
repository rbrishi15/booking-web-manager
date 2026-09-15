import {
  DomainError,
  Participation,
  Session,
  type SessionDetails,
} from "@/domain";
import { describe, expect, it, vi } from "vitest";
import {
  at,
  before,
  creationDetails,
  destination,
  end,
  join,
  session,
  sessionDetails,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session reconstruction and settlement state", () => {
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
    expect(() => s.completeSettlement("out", new Date(Number.NaN))).toThrow(
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
