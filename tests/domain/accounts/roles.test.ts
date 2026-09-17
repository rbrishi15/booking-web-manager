import { Booking, Money, ReliabilityScore, User } from "@/domain";
import { describe, expect, test } from "vitest";

const start = new Date("2026-10-10T10:00:00Z");
const end = new Date("2026-10-10T12:00:00Z");
const before = new Date("2026-10-08T10:00:00Z");

function user(userId: string): User {
  return User.create({ userId, email: `${userId}@example.com` });
}

function sessionOwnedBy(owner: User) {
  owner.beginPayoutSetup({
    payoutAccountId: "payout-account",
    providerAccountReference: "provider-account",
  });
  owner.completePayoutSetup("bank-account");

  return owner.asBooker().createSession({
    sessionId: "session",
    booking: new Booking({
      venueName: "Court",
      region: "North",
      sport: "Badminton",
      startAt: start,
      endAt: end,
      totalCost: Money.fromCents(1_000),
    }),
    totalSlots: 2,
    minimumHeadcount: 2,
    roomToken: "room",
    holdingAccountId: "platform",
    visibility: "PUBLIC",
    now: before,
  });
}

describe("User roles", () => {
  test("booker role creates and manages sessions for its user", () => {
    // Arrange
    const owner = user("owner");
    const session = sessionOwnedBy(owner);

    // Act
    const result = owner.asBooker().cancel(session, before);

    // Assert
    expect(session.bookerId).toBe(owner.userId);
    expect(session.status).toBe("CANCELLED");
    expect(result.instructions).toEqual([]);
  });

  test("participant role supplies identity while the caller supplies admission facts", () => {
    // Arrange
    const owner = user("owner");
    const participant = user("participant");
    const session = sessionOwnedBy(owner);

    // Act
    const admission = participant.asParticipant().join(session, {
      participationId: "participation",
      holdId: "hold",
      walletId: "wallet",
      availableBalance: Money.fromCents(1_000),
      memberGroupIds: [],
      score: ReliabilityScore.from(100),
      now: before,
    });
    const withdrawal = participant.asParticipant().withdraw(session, {
      participationId: admission.participationId,
      now: new Date(start.getTime() - 31 * 3_600_000),
    });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(withdrawal.kind).toBe("REFUNDED");
    expect(session.participations[0]?.userId).toBe(participant.userId);
    expect(session.participations[0]?.status).toBe("WITHDRAWN");
  });
});
