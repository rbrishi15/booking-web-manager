import {
  createUserReliability,
  Money,
  ReliabilityScore,
  Session,
} from "@/domain";
import { describe, expect, it } from "vitest";
import {
  before,
  captureError,
  creationDetails,
  loadedUser,
  join,
  session,
  sessionState,
  start,
} from "./session-fixtures";

describe("Session admission and roster", () => {
  it("uses the loaded user's memberships and reliability for private admission", () => {
    const s = Session.create({
      ...creationDetails(),
      visibility: "PRIVATE",
      invitedGroupId: "group",
      minimumReliability: ReliabilityScore.from(80),
    });
    const command = { participationId: "p-u", holdId: "h-u", now: before };
    const prior = sessionState(s);
    const lowScore = loadedUser("u", {
      memberGroupIds: ["group"],
      reliability: createUserReliability(
        "u",
        ReliabilityScore.from(79),
        before,
      ),
    });
    const eligible = loadedUser("u", {
      memberGroupIds: ["group"],
      reliability: createUserReliability(
        "u",
        ReliabilityScore.from(80),
        before,
      ),
    });

    expect(() => s.join(loadedUser("u"), command)).toThrow(
      expect.objectContaining({ code: "INVALID_ACCESS" }),
    );
    expect(() => lowScore.asParticipant().join(s, command)).toThrow(
      expect.objectContaining({ code: "LOW_RELIABILITY" }),
    );
    expect(sessionState(s)).toEqual(prior);

    const result = eligible.asParticipant().join(s, command);
    expect(result.kind).toBe("COMMITTED");
    expect(result.instructions[0]?.walletId).toBe(eligible.wallet.walletId);
  });

  it("checks the promotion user and uses a reloaded balance", () => {
    const s = session();
    join(s, "a");
    join(s, "b");
    const unfunded = loadedUser("c", {
      walletBalance: { walletId: "w-c", availableBalance: Money.fromCents(0) },
    });
    expect(
      s.join(unfunded, {
        participationId: "p-c",
        now: before,
      }).kind,
    ).toBe("WAITLISTED");
    s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: before,
    });
    const prior = sessionState(s);
    const command = { holdId: "h-c", now: before };

    expect(() => s.promoteNext(loadedUser("other"), command)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(sessionState(s)).toEqual(prior);

    const reloaded = loadedUser("c", {
      walletBalance: {
        walletId: "w-c",
        availableBalance: Money.fromCents(500),
      },
    });
    const result = s.promoteNext(reloaded, command);
    expect(result.kind).toBe("PROMOTED");
    expect(result.instructions[0]?.walletId).toBe("w-c");
    expect(unfunded.walletBalance.availableBalance.toCents()).toBe(0);
    expect(reloaded.walletBalance.availableBalance.toCents()).toBe(500);
  });

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
      [
        {
          walletBalance: {
            walletId: "w-u",
            availableBalance: Money.fromCents(499),
          },
        },
        "INSUFFICIENT_FUNDS",
      ],
    ] as const;

    // Act
    const rejectedResults = rejectedAdmissions.map(([patch, code]) => {
      const prior = sessionState(s);
      const operation = () =>
        s.join(loadedUser("u", patch), {
          participationId: "p",
          holdId: "h",
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
    const admitted = s.join(loadedUser("u"), {
      participationId: "p",
      holdId: "h",
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
    const wait = s.join(
      loadedUser("c", {
        walletBalance: {
          walletId: "w-c",
          availableBalance: Money.fromCents(0),
        },
      }),
      {
        participationId: "p-c",
        holdId: "h-c",
        now: before,
      },
    );
    join(s, "d");
    s.withdrawParticipant({
      actorId: "a",
      participationId: "p-a",
      now: before,
    });
    const fresh = join(s, "fresh");
    const firstPromotion = s.promoteNext(
      loadedUser("c", {
        walletBalance: {
          walletId: "w-c",
          availableBalance: Money.fromCents(0),
        },
      }),
      {
        holdId: "h-c",
        now: before,
      },
    );
    const nextWaiterAfterSkip = s.nextWaitlistedUserId;
    const secondPromotion = s.promoteNext(loadedUser("d"), {
      holdId: "h-d",
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
      s.join(loadedUser("c"), {
        participationId: "different",
        holdId: "h-c",
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
