import { describe, expect, it } from "vitest";
import { FundHold } from "../entities/fund-hold";
import { Participation } from "../entities/participation";
import { Money } from "../value-objects/money";
import { ReliabilityService } from "./reliability-service";

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
    expect(service.recalculate("u", [], asOf).toNumber()).toBe(100);
    const older = new Date(recentEnd.getTime() - 90 * day);
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
    expect(score).toBeCloseTo(100 / 1.5, 8);
  });

  it("derives one negative outcome for a finalized late withdrawal", () => {
    const end = recentEnd;
    const hold = FundHold.create({
      holdId: "h",
      participationId: "p",
      holdingAccountId: "platform",
      walletId: "w",
      amount: Money.fromCents(100),
      createdAt: new Date(end.getTime() - 2 * day),
    });
    const withdrawn = Participation.createCommitted({
      participationId: "p",
      userId: "u",
      committedAt: new Date(end.getTime() - 2 * day),
      hold,
    }).withdraw(hold.awaitReplacement(), new Date(end.getTime() - day));
    const finalized = Participation.reconstitute({
      ...withdrawn.snapshot(),
      hold: withdrawn.hold
        ?.markForfeitureDue(end)
        .forfeit("payout", end)
        .snapshot(),
    });
    expect(finalized.reliabilityOutcome(asOf)?.value).toBe(0);
    expect(
      service
        .recalculate("u", [{ participation: finalized, endAt: end }], asOf)
        .toNumber(),
    ).toBe(0);
  });

  it("rejects duplicate or foreign history and keeps scores stable as the clock advances", () => {
    const history = [
      { participation: attended("a"), endAt: recentEnd },
      {
        participation: absent("b", new Date(recentEnd.getTime() - 90 * day)),
        endAt: new Date(recentEnd.getTime() - 90 * day),
      },
    ];
    const first = service.recalculate("u", history, asOf).toNumber();
    expect(
      service
        .recalculate("u", history, new Date(asOf.getTime() + 365 * day))
        .toNumber(),
    ).toBe(first);
    const firstEntry = history[0];
    expect(firstEntry).toBeDefined();
    expect(() =>
      service.recalculate(
        "u",
        [
          firstEntry as (typeof history)[number],
          firstEntry as (typeof history)[number],
        ],
        asOf,
      ),
    ).toThrow(RangeError);
    expect(() =>
      service.recalculate(
        "u",
        [
          {
            participation: Participation.createWaitlisted({
              participationId: "foreign",
              userId: "other",
              waitlistedAt: recentEnd,
              queueSequence: 1,
            }),
            endAt: recentEnd,
          },
        ],
        asOf,
      ),
    ).toThrow(RangeError);
  });
});
