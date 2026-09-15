import { FundHold, Money, Participation, ReliabilityService } from "@/domain";
import { describe, expect, it } from "vitest";

const day = 86_400_000;
const asOf = new Date("2026-09-15T00:00:00Z");
const recentEnd = new Date(asOf.getTime() - day);
const service = new ReliabilityService();

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

describe("ReliabilityService", () => {
  it("defaults excluded history to 100 and weights an older absence at half life", () => {
    // Arrange
    const older = new Date(recentEnd.getTime() - 90 * day);

    // Act
    const emptyHistoryScore = service.recalculate("u", [], asOf).toNumber();
    const score = service
      .recalculate(
        "u",
        [
          { participation: attended("a"), endAt: recentEnd },
          { participation: absent("b", older), endAt: older },
        ],
        asOf,
      )
      .toNumber();

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
    const finalized = Participation.reconstitute({
      ...withdrawn.snapshot(),
      hold: withdrawn.hold
        ?.markForfeitureDue(end)
        .forfeit("payout", end)
        .snapshot(),
    });
    const outcome = finalized.reliabilityOutcome(asOf)?.value;
    const score = service
      .recalculate("u", [{ participation: finalized, endAt: end }], asOf)
      .toNumber();

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
    const first = service.recalculate("u", history, asOf).toNumber();
    const afterTimePasses = service
      .recalculate("u", history, new Date(asOf.getTime() + 365 * day))
      .toNumber();
    const duplicate = () =>
      service.recalculate(
        "u",
        [
          firstEntry as (typeof history)[number],
          firstEntry as (typeof history)[number],
        ],
        asOf,
      );
    const foreign = () =>
      service.recalculate(
        "u",
        [{ participation: foreignParticipation, endAt: recentEnd }],
        asOf,
      );

    // Assert
    expect(afterTimePasses).toBe(first);
    expect(duplicate).toThrow(RangeError);
    expect(foreign).toThrow(RangeError);
  });
});
