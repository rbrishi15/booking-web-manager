import { describe, expect, test } from "vitest";
import { Money } from "@/domain";
import {
  AccountNotActiveError,
  deleteAccount,
  type AccountStanding,
  type DeleteAccountPorts,
  type ProfileSnapshot,
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

/**
 * In-memory ports that record every step. `standings` are returned by successive loadStanding calls
 * (the last one repeats), so a test can make something change between the first check and the re-check.
 */
function fakePorts(
  standings: AccountStanding[],
  options: { readonly loginFails?: boolean; readonly claimedElsewhere?: boolean } = {},
) {
  const steps: string[] = [];
  const profile = { displayName: "Marcus Lim", status: "ACTIVE" };
  let loads = 0;

  const ports: DeleteAccountPorts = {
    loadStanding: async () => {
      steps.push("check");
      const standing = standings[Math.min(loads, standings.length - 1)];
      loads += 1;
      if (standing === undefined) throw new Error("no standing");
      return standing;
    },
    deactivateProfile: async (userId): Promise<ProfileSnapshot> => {
      steps.push("deactivate");
      if (options.claimedElsewhere === true) throw new AccountNotActiveError(userId);
      const snapshot = { userId, displayName: profile.displayName, preferredSports: ["Tennis"], preferredRegions: [] };
      profile.displayName = "";
      profile.status = "INACTIVE";
      return snapshot;
    },
    restoreProfile: async (snapshot) => {
      steps.push("restore");
      profile.displayName = snapshot.displayName;
      profile.status = "ACTIVE";
    },
    deleteLogin: async () => {
      steps.push("delete-login");
      if (options.loginFails === true) throw new Error("auth service unavailable");
    },
  };
  return { ports, steps, profile };
}

// Owner: Joseph (Jolingoes) — /app/profile
describe("UC1-04 Delete Account", () => {
  test("anonymises the user record rather than deleting it (soft delete)", async () => {
    // Arrange
    const { ports, steps, profile } = fakePorts([clearStanding()]);

    // Act
    const result = await deleteAccount(ports, COMMAND);

    // Assert
    expect(result).toEqual({ status: "DELETED" });
    expect(steps).toEqual(["check", "deactivate", "check", "delete-login"]);
    expect(profile).toEqual({ displayName: "", status: "INACTIVE" });
  });

  test("deletes an account that never had a wallet", async () => {
    // Arrange
    const { ports } = fakePorts([clearStanding({ walletId: null })]);

    // Act
    const result = await deleteAccount(ports, COMMAND);

    // Assert
    expect(result.status).toBe("DELETED");
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
      const { ports, steps } = fakePorts([standing]);

      // Act
      const result = await deleteAccount(ports, COMMAND);

      // Assert
      expect(result).toEqual({ status: "BLOCKED", standing });
      expect(steps).toEqual(["check"]);
    });
  });

  describe("never leaves the user stuck with a half-deleted account", () => {
    test("something that arrives after the first check blocks deletion and restores the profile", async () => {
      // Arrange: a top-up lands between the first check and the re-check.
      const toppedUp = clearStanding({ availableBalance: Money.fromCents(500) });
      const { ports, steps, profile } = fakePorts([clearStanding(), toppedUp]);

      // Act
      const result = await deleteAccount(ports, COMMAND);

      // Assert
      expect(result).toEqual({ status: "BLOCKED", standing: toppedUp });
      expect(steps).toEqual(["check", "deactivate", "check", "restore"]);
      expect(profile).toEqual({ displayName: "Marcus Lim", status: "ACTIVE" });
    });

    test("a second deletion that finds the account already claimed changes nothing", async () => {
      // Arrange: another deletion of the same account deactivated it first.
      const { ports, steps, profile } = fakePorts([clearStanding()], { claimedElsewhere: true });

      // Act
      const attempt = deleteAccount(ports, COMMAND);

      // Assert: this attempt never restores a profile it didn't deactivate.
      await expect(attempt).rejects.toBeInstanceOf(AccountNotActiveError);
      expect(steps).toEqual(["check", "deactivate"]);
      expect(profile).toEqual({ displayName: "Marcus Lim", status: "ACTIVE" });
    });

    test("a failed login removal restores the profile so the user can try again", async () => {
      // Arrange
      const { ports, steps, profile } = fakePorts([clearStanding()], { loginFails: true });

      // Act
      const attempt = deleteAccount(ports, COMMAND);

      // Assert
      await expect(attempt).rejects.toThrow("auth service unavailable");
      expect(steps).toEqual(["check", "deactivate", "check", "delete-login", "restore"]);
      expect(profile).toEqual({ displayName: "Marcus Lim", status: "ACTIVE" });
    });
  });
});
