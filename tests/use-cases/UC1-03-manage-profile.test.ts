import { describe, expect, test, vi } from "vitest";
import { profileSchema } from "@/app/profile/schemas";
import { FundHold, Money, Participation, type ParticipationHistoryEntry } from "@/domain";
import { GetReliabilityScore, type ReliabilityHistoryReader } from "@/use-cases/accounts/get-reliability-score";
import { UpdateProfile, type ProfileStore } from "@/use-cases/accounts/update-profile";
import type { AccountStatus } from "@/domain/shared/statuses";

/** A valid Edit profile submission; pass only the fields a test changes. */
function validProfile(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "Marcus Lim",
    preferredSports: ["Badminton", "Tennis"],
    preferredRegions: ["West"],
    handle: "marcus_lim",
    ...overrides,
  };
}

// Owner: Joseph (Jolingoes) — /app/profile
describe("UC1-03 Manage Profile", () => {
  test("updates editable profile fields through the application policy", async () => {
    // Arrange
    const store = profileStore("ACTIVE");
    const update = new UpdateProfile(store);

    // Act
    await update.forUser("alice", { displayName: " Alice ", preferredSports: ["Tennis", "Tennis"], preferredRegions: ["West"] });

    // Assert
    expect(store.saveForActiveUser).toHaveBeenCalledWith("alice", {
      displayName: "Alice", preferredSports: ["Tennis"], preferredRegions: ["West"],
    });
  });

  test("refuses an inactive account even when called without an HTTP handler", async () => {
    // Arrange
    const store = profileStore("INACTIVE");

    // Act & Assert
    await expect(new UpdateProfile(store).forUser("alice", {
      displayName: "Alice", preferredSports: ["Tennis"], preferredRegions: ["West"],
    })).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(store.saveForActiveUser).not.toHaveBeenCalled();
  });

  test("refuses whitespace preferences without relying on the form schema", async () => {
    // Arrange
    const store = profileStore("ACTIVE");

    // Act & Assert
    await expect(new UpdateProfile(store).forUser("alice", {
      displayName: "Alice", preferredSports: [" "], preferredRegions: ["West"],
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(store.saveForActiveUser).not.toHaveBeenCalled();
  });

  test("refuses empty profile edit preferences while bootstrap defaults stay separate", async () => {
    // Arrange
    const store = profileStore("ACTIVE");

    // Act & Assert
    await expect(new UpdateProfile(store).forUser("alice", {
      displayName: "Alice", preferredSports: [], preferredRegions: ["West"],
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(store.saveForActiveUser).not.toHaveBeenCalled();
  });

  test("reports missing profiles without inventing an active account", async () => {
    // Arrange
    const store = profileStore(null);

    // Act & Assert
    await expect(new UpdateProfile(store).forUser("alice", {
      displayName: "Alice", preferredSports: ["Tennis"], preferredRegions: ["West"],
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(store.saveForActiveUser).not.toHaveBeenCalled();
  });

  describe("computes the reliability score from the user's history (REQ-10)", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const day = 86_400_000;

    test("gives the starting score when the user has no history", async () => {
      // Arrange
      const { reader } = historyReader([]);

      // Act
      const score = await new GetReliabilityScore({ reader, clock: { now: () => now } }).forUser("alice");

      // Assert
      expect(score.toNumber()).toBe(100);
    });

    test("weights an absence one half-life older by half", async () => {
      // Arrange
      const recent = new Date(now.getTime() - day);
      const older = new Date(recent.getTime() - 90 * day);
      const { reader } = historyReader([
        { participation: verified("attended", "ATTENDED", recent), endAt: recent },
        { participation: verified("absent", "ABSENT", older), endAt: older },
      ]);

      // Act
      const score = await new GetReliabilityScore({ reader, clock: { now: () => now } }).forUser("alice");

      // Assert
      expect(score.toNumber()).toBeCloseTo(100 / 1.5, 8);
    });

    test("reads only the requested user's history", async () => {
      // Arrange
      const { reader, historyFor } = historyReader([]);

      // Act
      await new GetReliabilityScore({ reader, clock: { now: () => now } }).forUser("alice");

      // Assert
      expect(historyFor).toHaveBeenCalledExactlyOnceWith("alice");
    });

    test("passes a storage failure through instead of reporting the starting score", async () => {
      // Arrange
      const failure = new Error("database unavailable");
      const reader: ReliabilityHistoryReader = { historyFor: async () => { throw failure; } };

      // Act & Assert
      await expect(new GetReliabilityScore({ reader, clock: { now: () => now } }).forUser("alice")).rejects.toBe(failure);
    });

    /** A committed place for alice, verified at its session's end. */
    function verified(id: string, attendance: "ATTENDED" | "ABSENT", endAt: Date): Participation {
      const hold = FundHold.create({
        holdId: `h-${id}`, participationId: id, holdingAccountId: "platform", walletId: "w-alice",
        amount: Money.fromCents(500), createdAt: new Date(endAt.getTime() - day),
      });
      return Participation.createCommitted({
        participationId: id, userId: "alice", committedAt: new Date(endAt.getTime() - day), hold,
      }).verify(attendance, "BOOKER", endAt);
    }
  });

  describe("checks the Edit profile form at the boundary (Zod)", () => {
    test("accepts several sports and regions (REQ-3, REQ-4)", () => {
      // Arrange
      const input = validProfile({ preferredRegions: ["West", "Central"] });

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data?.preferredSports).toEqual(["Badminton", "Tennis"]);
      expect(result.data?.preferredRegions).toEqual(["West", "Central"]);
    });

    test("trims the name", () => {
      // Arrange
      const input = validProfile({ displayName: "  Marcus Lim  " });

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.data?.displayName).toBe("Marcus Lim");
    });

    test("removes repeated picks", () => {
      // Arrange
      const input = validProfile({ preferredSports: ["Tennis", "Tennis"] });

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.data?.preferredSports).toEqual(["Tennis"]);
    });

    test.each([
      ["displayName", { displayName: "   " }, "Enter your name"],
      ["displayName", { displayName: "x".repeat(61) }, "Keep your name under 60 characters"],
      ["preferredSports", { preferredSports: [] }, "Choose at least one sport"],
      ["preferredRegions", { preferredRegions: [] }, "Choose at least one region"],
      ["preferredSports", { preferredSports: ["Chess"] }, "Choose sports from the list"],
      ["preferredRegions", { preferredRegions: ["Johor"] }, "Choose regions from the list"],
    ] as const)("rejects a bad %s", (field, overrides, message) => {
      // Arrange
      const input = validProfile(overrides);

      // Act
      const result = profileSchema.safeParse(input);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error?.flatten().fieldErrors[field]).toEqual([message]);
    });
  });
});

function historyReader(history: readonly ParticipationHistoryEntry[]) {
  const historyFor = vi.fn<ReliabilityHistoryReader["historyFor"]>().mockResolvedValue(history);
  return { reader: { historyFor } satisfies ReliabilityHistoryReader, historyFor };
}

function profileStore(status: AccountStatus | null) {
  return {
    getAccountStatus: async () => status,
    saveForActiveUser: vi.fn<ProfileStore["saveForActiveUser"]>().mockResolvedValue(undefined),
  } satisfies ProfileStore;
}
