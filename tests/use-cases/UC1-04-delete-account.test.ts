import { describe, expect, test } from "vitest";
import { Money } from "@/domain";
import {
  deleteAccount,
  type AccountStanding,
  type DeleteAccountPorts,
} from "@/use-cases/accounts/delete-account";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const COMMAND = { userId: USER_ID, email: "marcus@example.com", now: new Date("2026-10-01T00:00:00Z") };

/** A standing with nothing outstanding; pass only the fields a test changes. */
function clearStanding(overrides: Partial<AccountStanding> = {}): AccountStanding {
  return {
    walletId: "22222222-2222-4222-8222-222222222222",
    availableBalance: Money.fromCents(0),
    heldBalance: Money.fromCents(0),
    activeCommitments: 0,
    unsettledOwnedSessions: 0,
    pendingPayouts: 0,
    activeOwnedGroups: 0,
    ...overrides,
  };
}

/** In-memory ports that remember which accounts were soft-deleted. */
function fakePorts(standing: AccountStanding) {
  const deactivated: string[] = [];
  const ports: DeleteAccountPorts = {
    loadStanding: async () => standing,
    anonymiseAndDeactivate: async (userId) => {
      deactivated.push(userId);
    },
  };
  return { ports, deactivated };
}

// Owner: Joseph (Jolingoes) — /app/profile
describe("UC1-04 Delete Account", () => {
  test("anonymises the user record rather than deleting it (soft delete)", async () => {
    // Arrange
    const { ports, deactivated } = fakePorts(clearStanding());

    // Act
    const result = await deleteAccount(ports, COMMAND);

    // Assert
    expect(result).toEqual({ status: "DELETED" });
    expect(deactivated).toEqual([USER_ID]);
  });

  test("deletes an account that never had a wallet", async () => {
    // Arrange
    const { ports, deactivated } = fakePorts(clearStanding({ walletId: null }));

    // Act
    const result = await deleteAccount(ports, COMMAND);

    // Assert
    expect(result.status).toBe("DELETED");
    expect(deactivated).toEqual([USER_ID]);
  });

  test.todo("retains the anonymised record for audit");

  describe("exception 2a: refuses while money or commitments are outstanding", () => {
    test.each([
      ["a positive available balance", { availableBalance: Money.fromCents(1) }],
      ["funds held for a session", { heldBalance: Money.fromCents(750) }],
      ["an active commitment", { activeCommitments: 1 }],
      ["an unsettled owned session", { unsettledOwnedSessions: 1 }],
      ["a pending payout", { pendingPayouts: 1 }],
      ["an active owned group", { activeOwnedGroups: 1 }],
    ] as const)("blocks %s", async (_case, overrides) => {
      // Arrange
      const standing = clearStanding(overrides);
      const { ports, deactivated } = fakePorts(standing);

      // Act
      const result = await deleteAccount(ports, COMMAND);

      // Assert
      expect(result).toEqual({ status: "BLOCKED", standing });
      expect(deactivated).toEqual([]);
    });
  });
});
