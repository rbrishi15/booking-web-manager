import { Booking, Money, User } from "@/domain";
import { describe, expect, test } from "vitest";
import { createTestUser } from "./user-fixtures";

const start = new Date("2026-10-10T10:00:00Z");
const end = new Date("2026-10-10T12:00:00Z");
const before = new Date("2026-10-08T10:00:00Z");

describe("Participant", () => {
  test("withdraw_WhenCommittedBeforeRefundCutoff_RefundsParticipant", () => {
    // Arrange
    const owner = createTestUser({ userId: "owner" });
    const participant = createTestUser({ userId: "participant" });
    const session = sessionOwnedBy(owner);

    // Act
    const admission = participant.asParticipant().join(session, {
      participationId: "participation",
      holdId: "hold",
      now: before,
    });
    const withdrawal = participant.asParticipant().withdraw(session, {
      participationId: admission.participationId,
      now: new Date(start.getTime() - 31 * 3_600_000),
    });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(withdrawal.kind).toBe("REFUNDED");
    expect(
      session.participantList.requireParticipation("participation").userId,
    ).toBe(participant.userId);
    expect(
      session.participantList.requireParticipation("participation").status,
    ).toBe("WITHDRAWN");
  });

  test("join_WhenUserHasFunds_LocksShareFromLoadedWallet", () => {
    // Arrange
    const participantUser = createTestUser({ userId: "participant" });
    const session = sessionOwnedBy(createTestUser({ userId: "owner" }));

    // Act
    const admission = participantUser.asParticipant().join(session, {
      participationId: "participation",
      holdId: "hold",
      now: before,
    });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(
      session.participantList.requireParticipation("participation").userId,
    ).toBe(participantUser.userId);
    expect(admission.instructions).toEqual([
      expect.objectContaining({
        kind: "LOCK",
        walletId: "w-participant",
        participationId: "participation",
        holdId: "hold",
      }),
    ]);
    expect(admission.instructions[0]?.amount.toCents()).toBe(500);
  });

  test("join_WhenRoleWasCreatedBeforeDeactivation_ThrowsInactiveAccount", () => {
    // Arrange
    const participantUser = createTestUser({
      userId: "participant",
      availableFundsCents: 0,
    });
    const session = sessionOwnedBy(createTestUser({ userId: "owner" }));
    const participant = participantUser.asParticipant();
    participantUser.deactivate({
      availableBalance: Money.fromCents(0),
      heldBalance: Money.fromCents(0),
      activeCommitments: 0,
      unsettledOwnedSessions: 0,
      pendingPayouts: 0,
      activeOwnedGroups: 0,
    });

    // Act & Assert
    expect(() =>
      participant.join(session, {
        participationId: "participation",
        holdId: "hold",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    expect(session.participantList.participations).toEqual([]);
  });

  test("join_WhenRoleWasCreatedAfterDeactivation_ThrowsInactiveAccount", () => {
    // Arrange
    const participantUser = createTestUser({
      userId: "participant",
      availableFundsCents: 0,
    });
    const session = sessionOwnedBy(createTestUser({ userId: "owner" }));

    participantUser.deactivate({
      availableBalance: Money.fromCents(0),
      heldBalance: Money.fromCents(0),
      activeCommitments: 0,
      unsettledOwnedSessions: 0,
      pendingPayouts: 0,
      activeOwnedGroups: 0,
    });
    const participant = participantUser.asParticipant();

    // Act & Assert
    expect(() =>
      participant.join(session, {
        participationId: "participation",
        holdId: "hold",
        now: before,
      }),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    expect(session.participantList.participations).toEqual([]);
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
