import { describe, expect, test } from "vitest";
import { assertDeactivationAllowed, Money, type DeactivationInput } from "@/domain";

describe("Deactivation policy", () => {
  test("assertDeactivationAllowed_WhenNoObligationsRemain_AllowsDeactivation", () => {
    // Arrange
    const standing = clearStanding();

    // Act & Assert
    expect(() => assertDeactivationAllowed(standing)).not.toThrow();
  });

  test("assertDeactivationAllowed_WhenFundsAreHeld_ThrowsActiveObligations", () => {
    // Arrange
    const standing = { ...clearStanding(), heldBalance: Money.fromCents(500) };

    // Act & Assert
    expect(() => assertDeactivationAllowed(standing)).toThrow(
      expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
    );
  });

  test("assertDeactivationAllowed_WhenAnOwnedGroupIsActive_ThrowsActiveObligations", () => {
    // Arrange
    const standing = { ...clearStanding(), activeOwnedGroups: 1 };

    // Act & Assert
    expect(() => assertDeactivationAllowed(standing)).toThrow(
      expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
    );
  });

  test("assertDeactivationAllowed_WhenBalanceIsNegative_ThrowsInvalidInput", () => {
    // Arrange
    const standing = { ...clearStanding(), availableBalance: Money.fromCents(-1) };

    // Act & Assert
    expect(() => assertDeactivationAllowed(standing)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("assertDeactivationAllowed_WhenObligationCountIsFractional_ThrowsInvalidInput", () => {
    // Arrange
    const standing = { ...clearStanding(), activeCommitments: 0.5 };

    // Act & Assert
    expect(() => assertDeactivationAllowed(standing)).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });
});

function clearStanding(): DeactivationInput {
  return {
    availableBalance: Money.fromCents(0),
    heldBalance: Money.fromCents(0),
    activeCommitments: 0,
    unsettledOwnedSessions: 0,
    pendingPayouts: 0,
    activeOwnedGroups: 0,
  };
}
