import { Money, ReliabilityScore } from "@/domain";
import { describe, expect, test } from "vitest";
import { createTestUser } from "../user-fixtures";

describe("Participant", () => {
  test("assertCanDiscoverSessions_WhenActiveWithNoFundsOrReliability_AllowsDiscovery", () => {
    // Arrange
    const participant = createTestUser({
      userId: "alice",
      availableFundsCents: 0,
      reliabilityScore: ReliabilityScore.from(0),
    }).asParticipant();

    // Act
    const result = participant.assertCanDiscoverSessions();

    // Assert
    expect(result).toBeUndefined();
  });

  test("assertCanDiscoverSessions_WhenAccountIsInactive_ThrowsInactiveAccount", () => {
    // Arrange
    const participant = createTestUser({
      userId: "alice",
      accountStatus: "INACTIVE",
    }).asParticipant();

    // Act & Assert
    expect(() => participant.assertCanDiscoverSessions()).toThrow(
      expect.objectContaining({
        code: "INACTIVE_ACCOUNT",
        message: "An inactive account cannot use the session API",
      }),
    );
  });

  test("assertCanDiscoverSessions_WhenRolePredatesDeactivation_ThrowsInactiveAccount", () => {
    // Arrange
    const user = createTestUser({ userId: "alice", availableFundsCents: 0 });
    const participant = user.asParticipant();
    user.deactivate({
      availableBalance: Money.fromCents(0),
      heldBalance: Money.fromCents(0),
      activeCommitments: 0,
      unsettledOwnedSessions: 0,
      pendingPayouts: 0,
      activeOwnedGroups: 0,
    });

    // Act & Assert
    expect(() => participant.assertCanDiscoverSessions()).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
  });
});
