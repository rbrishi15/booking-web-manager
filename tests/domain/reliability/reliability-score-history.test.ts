import { FundHold, Money, Participation, ReliabilityScore } from "@/domain";
import { describe, expect, it } from "vitest";

const day = 86_400_000;
const asOf = new Date("2026-09-15T00:00:00Z");
const recentEnd = new Date(asOf.getTime() - day);

function attended(id: string, endAt = recentEnd): Participation {
  const hold = FundHold.create({
    holdId: `h-${id}`,
    participationId: id,
    holdingAccountId: "platform",
    walletId: `w-${id}`,
    amount: Money.fromCents(100),
    createdAt: new Date(endAt.getTime() - day),
  });
  return Participation.createCommitted({
    participationId: id,
    userId: "u",
    committedAt: new Date(endAt.getTime() - day),
    hold,
  }).verify("ATTENDED", "BOOKER", endAt);
}

function absent(id: string, endAt = recentEnd): Participation {
  const hold = FundHold.create({
    holdId: `h-${id}`,
    participationId: id,
    holdingAccountId: "platform",
    walletId: `w-${id}`,
    amount: Money.fromCents(100),
    createdAt: new Date(endAt.getTime() - day),
  });
  return Participation.createCommitted({
    participationId: id,
    userId: "u",
    committedAt: new Date(endAt.getTime() - day),
    hold,
  }).verify("ABSENT", "AUTOMATIC", endAt);
}

describe("ReliabilityScore.fromHistory", () => {
  it("defaults excluded history to 100 and weights an older absence at half life", () => {
    // Arrange
    const older = new Date(recentEnd.getTime() - 90 * day);

    // Act
    const emptyHistoryScore = ReliabilityScore.fromHistory(
      "u",
      [],
      asOf,
    ).toNumber();
    const score = ReliabilityScore.fromHistory(
      "u",
      [
        { participation: attended("a"), endAt: recentEnd },
        { participation: absent("b", older), endAt: older },
      ],
      asOf,
    ).toNumber();

    // Assert
    expect(emptyHistoryScore).toBe(100);
    expect(score).toBeCloseTo(100 / 1.5, 8);
  });

  it("derives one negative outcome for a finalized late withdrawal", () => {
    // Arrange
    const end = recentEnd;
    const hold = FundHold.create({
      holdId: "h",
      participationId: "p",
      holdingAccountId: "platform",
      walletId: "w",
      amount: Money.fromCents(100),
      createdAt: new Date(end.getTime() - 2 * day),
    });
    const committed = Participation.createCommitted({
      participationId: "p",
      userId: "u",
      committedAt: new Date(end.getTime() - 2 * day),
      hold,
    });

    // Act
    const awaitingReplacement = hold.awaitReplacement();
    const withdrawn = committed.withdraw(
      awaitingReplacement,
      new Date(end.getTime() - day),
    );
    const finalized = withdrawn
      .expireReplacement(end)
      .settleHold("FORFEIT", "payout", end);
    const outcome = finalized.reliabilityOutcome(asOf)?.value;
    const score = ReliabilityScore.fromHistory(
      "u",
      [{ participation: finalized, endAt: end }],
      asOf,
    ).toNumber();

    // Assert
    expect(outcome).toBe(0);
    expect(score).toBe(0);
  });

  it("rejects duplicate or foreign history and keeps scores stable as the clock advances", () => {
    // Arrange
    const olderEnd = new Date(recentEnd.getTime() - 90 * day);
    const history: [
      { participation: Participation; endAt: Date },
      { participation: Participation; endAt: Date },
    ] = [
      { participation: attended("a"), endAt: recentEnd },
      { participation: absent("b", olderEnd), endAt: olderEnd },
    ];

    const firstEntry = history[0];
    const foreignParticipation = Participation.createWaitlisted({
      participationId: "foreign",
      userId: "other",
      waitlistedAt: recentEnd,
      queueSequence: 1,
    });

    // Act
    const first = ReliabilityScore.fromHistory("u", history, asOf).toNumber();
    const afterTimePasses = ReliabilityScore.fromHistory(
      "u",
      history,
      new Date(asOf.getTime() + 365 * day),
    ).toNumber();
    const duplicate = () =>
      ReliabilityScore.fromHistory(
        "u",
        [
          firstEntry as (typeof history)[number],
          firstEntry as (typeof history)[number],
        ],
        asOf,
      );
    const foreign = () =>
      ReliabilityScore.fromHistory(
        "u",
        [{ participation: foreignParticipation, endAt: recentEnd }],
        asOf,
      );

    // Assert
    expect(afterTimePasses).toBe(first);
    expect(duplicate).toThrow(RangeError);
    expect(foreign).toThrow(RangeError);
  });

  it("excludes unfinished, future-ended, and not-yet-finalized history", () => {
    const future = new Date(asOf.getTime() + day);
    const waiting = Participation.createWaitlisted({
      participationId: "waiting",
      userId: "u",
      waitlistedAt: recentEnd,
      queueSequence: 1,
    });
    const score = ReliabilityScore.fromHistory(
      "u",
      [
        { participation: waiting, endAt: recentEnd },
        { participation: absent("future-end", future), endAt: future },
        {
          participation: absent("future-finalization", future),
          endAt: recentEnd,
        },
      ],
      asOf,
    );

    expect(score.toNumber()).toBe(100);
  });

  it("includes an outcome finalized at the cutoff and returns an immutable score", () => {
    const score = ReliabilityScore.fromHistory(
      "u",
      [{ participation: absent("at-cutoff", asOf), endAt: asOf }],
      asOf,
    );

    expect(score.toNumber()).toBe(0);
    expect(Object.isFrozen(score)).toBe(true);
  });

  it("rejects invalid calculation and session-end dates", () => {
    expect(() => ReliabilityScore.fromHistory("u", [], new Date(NaN))).toThrow(
      RangeError,
    );
    expect(() =>
      ReliabilityScore.fromHistory(
        "u",
        [{ participation: attended("a"), endAt: new Date(NaN) }],
        asOf,
      ),
    ).toThrow(RangeError);
  });
});
