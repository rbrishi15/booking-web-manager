import { Booking, Money, User } from "@/domain";
import { describe, expect, test } from "vitest";
import { createTestUser } from "./user-fixtures";

const start = new Date("2026-10-10T10:00:00Z");
const end = new Date("2026-10-10T12:00:00Z");
const before = new Date("2026-10-08T10:00:00Z");

describe("Booker", () => {
  test("cancel_WhenOwnerCancelsEmptySession_ReturnsNoInstructions", () => {
    // Arrange
    const owner = createTestUser({ userId: "owner" });
    const session = sessionOwnedBy(owner);

    // Act
    const cancellation = owner.asBooker().cancel(session, before);

    // Assert
    expect(session.bookerId).toBe(owner.userId);
    expect(session.status).toBe("CANCELLED");
    expect(cancellation.instructions).toEqual([]);
  });
});

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
