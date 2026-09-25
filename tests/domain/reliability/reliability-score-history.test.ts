import { FundHold, Money, Participation, ReliabilityScore } from "@/domain";
import { describe, expect, test } from "vitest";

const day = 86_400_000;
const asOf = new Date("2026-09-15T00:00:00Z");
const recentEnd = new Date(asOf.getTime() - day);

describe("ReliabilityScore", () => {
  test("fromHistory_WhenHistoryIsEmpty_ReturnsMaximumScore", () => {
    // Arrange
    const history: { participation: Participation; endAt: Date }[] = [];

    // Act
    const score = ReliabilityScore.fromHistory("u", history, asOf);

    // Assert
    expect(score.toNumber()).toBe(100);
  });

  test("fromHistory_WhenAbsenceIsOneHalfLifeOlder_WeightsItByHalf", () => {
    // Arrange
    const olderEnd = new Date(recentEnd.getTime() - 90 * day);
    const history = [
      { participation: attended("a"), endAt: recentEnd },
      { participation: absent("b", olderEnd), endAt: olderEnd },
    ];

    // Act
    const score = ReliabilityScore.fromHistory("u", history, asOf);

    // Assert
    expect(score.toNumber()).toBeCloseTo(100 / 1.5, 8);
  });

  test("fromHistory_WhenLateWithdrawalIsFinalized_CountsOneNegativeOutcome", () => {
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

  test("fromHistory_WhenClockAdvances_PreservesRelativeWeights", () => {
    // Arrange
    const olderEnd = new Date(recentEnd.getTime() - 90 * day);
    const history = [
      { participation: attended("a"), endAt: recentEnd },
      { participation: absent("b", olderEnd), endAt: olderEnd },
    ];
    const originalScore = ReliabilityScore.fromHistory("u", history, asOf);

    // Act
    const laterScore = ReliabilityScore.fromHistory(
      "u",
      history,
      new Date(asOf.getTime() + 365 * day),
    );

    // Assert
    expect(laterScore.toNumber()).toBe(originalScore.toNumber());
  });

  test("fromHistory_WhenParticipationIsDuplicated_ThrowsRangeError", () => {
    // Arrange
    const entry = { participation: attended("a"), endAt: recentEnd };

    // Act & Assert
    expect(() =>
      ReliabilityScore.fromHistory("u", [entry, entry], asOf),
    ).toThrow(RangeError);
  });

  test("fromHistory_WhenParticipationBelongsToAnotherUser_ThrowsRangeError", () => {
    // Arrange
    const participation = Participation.createWaitlisted({
      participationId: "foreign",
      userId: "other",
      waitlistedAt: recentEnd,
      queueSequence: 1,
    });

    // Act & Assert
    expect(() =>
      ReliabilityScore.fromHistory(
        "u",
        [{ participation, endAt: recentEnd }],
        asOf,
      ),
    ).toThrow(RangeError);
  });

  test("fromHistory_WhenParticipationIsUnfinished_ExcludesEntry", () => {
    // Arrange
    const participation = Participation.createWaitlisted({
      participationId: "waiting",
      userId: "u",
      waitlistedAt: recentEnd,
      queueSequence: 1,
    });
    const history = [{ participation, endAt: recentEnd }];

    // Act
    const score = ReliabilityScore.fromHistory("u", history, asOf);

    // Assert
    expect(score.toNumber()).toBe(100);
  });

  test("fromHistory_WhenSessionEndsInFuture_ExcludesEntry", () => {
    // Arrange
    const future = new Date(asOf.getTime() + day);
    const history = [
      { participation: absent("future-end", future), endAt: future },
    ];

    // Act
    const score = ReliabilityScore.fromHistory("u", history, asOf);

    // Assert
    expect(score.toNumber()).toBe(100);
  });

  test("fromHistory_WhenOutcomeIsFinalizedInFuture_ExcludesEntry", () => {
    // Arrange
    const future = new Date(asOf.getTime() + day);
    const history = [
      {
        participation: absent("future-finalization", future),
        endAt: recentEnd,
      },
    ];

    // Act
    const score = ReliabilityScore.fromHistory("u", history, asOf);

    // Assert
    expect(score.toNumber()).toBe(100);
  });

  test("fromHistory_WhenOutcomeIsFinalizedAtCutoff_IncludesOutcomeInImmutableScore", () => {
    // Arrange
    const history = [{ participation: absent("at-cutoff", asOf), endAt: asOf }];

    // Act
    const score = ReliabilityScore.fromHistory("u", history, asOf);

    // Assert
    expect(score.toNumber()).toBe(0);
    expect(Object.isFrozen(score)).toBe(true);
  });

  test("fromHistory_WhenCalculationDateIsInvalid_ThrowsRangeError", () => {
    // Arrange
    const invalidDate = new Date(NaN);

    // Act & Assert
    expect(() => ReliabilityScore.fromHistory("u", [], invalidDate)).toThrow(
      RangeError,
    );
  });

  test("fromHistory_WhenSessionEndDateIsInvalid_ThrowsRangeError", () => {
    // Arrange
    const history = [{ participation: attended("a"), endAt: new Date(NaN) }];

    // Act & Assert
    expect(() => ReliabilityScore.fromHistory("u", history, asOf)).toThrow(
      RangeError,
    );
  });
});

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
