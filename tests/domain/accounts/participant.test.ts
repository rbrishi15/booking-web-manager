import { Money } from "@/domain";
import { describe, expect, test } from "vitest";
import {
  hoursBeforeSessionStart,
  createTestSession,
  createTestUser,
} from "../sessions/session/session-fixtures";

describe("Participant", () => {
  test("withdraw_WhenCommittedBeforeRefundCutoff_RefundsParticipant", () => {
    // Arrange
    const participant = createTestUser({
      userId: "participant",
    }).asParticipant();
    const session = createTestSession({ committedUserIds: ["participant"] });

    // Act
    const withdrawal = participant.withdraw(session, {
      participationId: "p-participant",
      now: hoursBeforeSessionStart(31),
    });

    // Assert
    expect(withdrawal.kind).toBe("REFUNDED");
    const withdrawn =
      session.participantList.requireParticipation("p-participant");
    expect(withdrawn.userId).toBe(participant.userId);
    expect(withdrawn.status).toBe("WITHDRAWN");
    expect(withdrawn.hold?.state).toBe("REFUNDED");
    expect(withdrawal.instructions).toEqual([
      expect.objectContaining({
        kind: "REFUND",
        participationId: "p-participant",
        holdId: "h-participant",
        walletId: "w-participant",
      }),
    ]);
    expect(withdrawal.instructions[0]?.amount.toCents()).toBe(500);
  });

  test("join_WhenUserHasFunds_LocksShareFromLoadedWallet", () => {
    // Arrange
    const participantUser = createTestUser({ userId: "participant" });
    const session = createTestSession();

    // Act
    const admission = participantUser.asParticipant().join(session, {
      participationId: "participation",
      holdId: "hold",
      now: hoursBeforeSessionStart(48),
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
    const session = createTestSession();
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
        now: hoursBeforeSessionStart(48),
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
    const session = createTestSession();

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
        now: hoursBeforeSessionStart(48),
      }),
    ).toThrow(expect.objectContaining({ code: "INACTIVE_ACCOUNT" }));
    expect(session.participantList.participations).toEqual([]);
  });
});
