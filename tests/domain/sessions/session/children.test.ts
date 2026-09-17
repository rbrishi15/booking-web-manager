import {
  DomainError,
  FundHold,
  type FundHoldDetails,
  Money,
  Participation,
  type ParticipationDetails,
} from "@/domain";
import { describe, expect, it } from "vitest";

const createdAt = new Date("2026-10-01");
const settledAt = new Date("2026-10-03");
function holdDetails(
  overrides: Partial<FundHoldDetails> = {},
): FundHoldDetails {
  return {
    holdId: "hold",
    participationId: "participation",
    holdingAccountId: "platform",
    walletId: "wallet",
    amount: Money.fromCents(500),
    state: "HELD",
    createdAt: new Date(createdAt),
    ...overrides,
  };
}

describe("FundHold constructor", () => {
  it.each(["HELD", "AWAITING_REPLACEMENT", "FORFEITURE_DUE"] as const)(
    "accepts existing %s funds",
    (state) => {
      const input = holdDetails({ state });
      const hold = new FundHold(input);
      input.createdAt.setTime(0);
      hold.createdAt.setTime(0);
      expect(hold.state).toBe(state);
      expect(hold.amount.toCents()).toBe(500);
      expect(hold.createdAt).toEqual(createdAt);
    },
  );

  it.each(["REFUNDED", "RELEASED", "FORFEITED"] as const)(
    "accepts existing %s funds and preserves terminal metadata",
    (state) => {
      const date = new Date(settledAt);
      const hold = new FundHold(
        holdDetails({
          state,
          settledAt: date,
          payoutId: state === "REFUNDED" ? undefined : "payout",
        }),
      );
      date.setTime(0);
      hold.settledAt?.setTime(0);
      expect(hold.state).toBe(state);
      expect(hold.settledAt).toEqual(settledAt);
      expect(hold.payoutId).toBe(state === "REFUNDED" ? undefined : "payout");
      expect(() => hold.refund(settledAt)).toThrow(DomainError);
    },
  );

  it("rejects inconsistent lifecycle fields and invalid values", () => {
    const invalid: Partial<FundHoldDetails>[] = [
      { state: "RELEASED" },
      { state: "RELEASED", settledAt },
      { state: "FORFEITED", settledAt, payoutId: " " },
      { state: "REFUNDED", settledAt, payoutId: "payout" },
      { settledAt },
      { payoutId: "payout" },
      { amount: Money.fromCents(0) },
      { state: "UNKNOWN" as FundHoldDetails["state"] },
    ];
    for (const change of invalid)
      expect(() => new FundHold(holdDetails(change))).toThrow(DomainError);
    expect(
      () => new FundHold(holdDetails({ createdAt: new Date(NaN) })),
    ).toThrow(RangeError);
  });
});

function participationDetails(
  overrides: Partial<ParticipationDetails> = {},
): ParticipationDetails {
  return {
    participationId: "participation",
    userId: "user",
    status: "COMMITTED",
    attendance: "UNVERIFIED",
    committedAt: new Date(createdAt),
    hold: new FundHold(holdDetails()),
    ...overrides,
  };
}

describe("Participation constructor and immutable transitions", () => {
  it("owns timestamps, shares immutable holds, and returns new children for transitions", () => {
    const input = participationDetails();
    const committed = new Participation(input);
    input.committedAt?.setTime(0);
    committed.committedAt?.setTime(0);
    expect(committed.committedAt).toEqual(createdAt);
    expect(committed.hold).toBe(input.hold);
    const withdrawn = committed.withdraw(
      committed.hold!.awaitReplacement(),
      createdAt,
    );
    const refunded = withdrawn.refundReplacement(settledAt);
    const forfeited = withdrawn
      .expireReplacement(settledAt)
      .settleHold("FORFEIT", "payout", settledAt);
    expect(committed.status).toBe("COMMITTED");
    expect(committed.hold?.state).toBe("HELD");
    expect(withdrawn.hold?.state).toBe("AWAITING_REPLACEMENT");
    expect(refunded.hold?.state).toBe("REFUNDED");
    expect(forfeited.hold?.state).toBe("FORFEITED");
    expect(forfeited.reliabilityOutcome(settledAt)?.value).toBe(0);
  });

  it("rejects foreign holds and inconsistent attendance, queue, and lifecycle fields", () => {
    const invalid: Partial<ParticipationDetails>[] = [
      { hold: new FundHold(holdDetails({ participationId: "foreign" })) },
      { hold: undefined },
      { committedAt: undefined },
      { attendance: "ATTENDED" },
      { verifiedAt: settledAt, verificationMethod: "BOOKER" },
      { status: "WAITLISTED", hold: undefined },
      { status: "WAITLISTED", waitlistedAt: createdAt, queueSequence: 1 },
      { status: "WITHDRAWN", withdrawnAt: settledAt },
      { status: "CANCELLED" },
      { status: "REMOVED" },
      { queueSequence: 0 },
      { replacesParticipationId: "participation" },
      { replacementMode: "INVITE_LINK", replacementToken: "token" },
    ];
    for (const change of invalid)
      expect(() => new Participation(participationDetails(change))).toThrow(
        DomainError,
      );
  });

  it("promotes with replacement identity and settles according to attendance", () => {
    const queued = Participation.createWaitlisted({
      participationId: "participation",
      userId: "user",
      waitlistedAt: createdAt,
      queueSequence: 1,
    });
    const committed = queued.commit(
      new FundHold(holdDetails()),
      createdAt,
      "previous",
    );
    expect(committed.replacesParticipationId).toBe("previous");
    expect(queued.status).toBe("WAITLISTED");
    expect(queued.hold).toBeUndefined();
    expect(() => committed.settleHold("RELEASE", "payout", settledAt)).toThrow(
      DomainError,
    );
    const attended = committed.verify("ATTENDED", "BOOKER", settledAt);
    expect(
      attended.settleHold("RELEASE", "payout", settledAt).hold?.state,
    ).toBe("RELEASED");
    expect(attended.hold?.state).toBe("HELD");
    expect(() => attended.settleHold("FORFEIT", "payout", settledAt)).toThrow(
      DomainError,
    );
  });
});
