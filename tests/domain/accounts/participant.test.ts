import { Booking, Money, User } from "@/domain";
import { describe, expect, test } from "vitest";
import { fundedWallet, loadedUser } from "./user-fixtures";

const start = new Date("2026-10-10T10:00:00Z");
const end = new Date("2026-10-10T12:00:00Z");
const before = new Date("2026-10-08T10:00:00Z");

describe("Participant", () => {
  test("withdraw_WhenCommittedBeforeRefundCutoff_RefundsParticipant", () => {
    // Arrange
    const owner = loadedUser("owner");
    const participant = loadedUser("participant");
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
    expect(session.participations[0]?.userId).toBe(participant.userId);
    expect(session.participations[0]?.status).toBe("WITHDRAWN");
  });

  test("join_WhenUserHasFunds_LocksShareFromLoadedWallet", () => {
    // Arrange
    const participantUser = loadedUser("participant");
    const session = sessionOwnedBy(loadedUser("owner"));

    // Act
    const admission = participantUser.asParticipant().join(session, {
      participationId: "participation",
      holdId: "hold",
      now: before,
    });

    // Assert
    expect(admission.kind).toBe("COMMITTED");
    expect(session.participations[0]?.userId).toBe(participantUser.userId);
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
    const participantUser = loadedUser("participant", {
      wallet: fundedWallet("participant", 0),
    });
    const session = sessionOwnedBy(loadedUser("owner"));
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
    expect(session.participations).toEqual([]);
  });

  test("join_WhenRoleWasCreatedAfterDeactivation_ThrowsInactiveAccount", () => {
    // Arrange
    const participantUser = loadedUser("participant", {
      wallet: fundedWallet("participant", 0),
    });
    const session = sessionOwnedBy(loadedUser("owner"));

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
    expect(session.participations).toEqual([]);
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
