import { describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import type { UserHandle } from "@/domain/accounts/user-handle";
import { UpdateProfile, type ProfileStore } from "@/use-cases/accounts/update-profile";
import { CheckUserHandle, FindUserByHandle, type UserDirectory, type UserSummary } from "@/use-cases/accounts/user-handles";

const MARCUS: UserSummary = { userId: "6f1c2a7e-4b8d-4c1e-9a3f-2d5b7c9e1f03", handle: "marcus_lim", displayName: "Marcus Lim" };

/** An in-memory directory holding these accounts' user IDs; only `active` ones can be found. */
function directory(accounts: readonly (UserSummary & { readonly active?: boolean })[]): UserDirectory {
  return {
    isHandleFree: vi.fn(async (handle: UserHandle) => !accounts.some((account) => account.handle === handle.toString())),
    findActiveByHandle: vi.fn(async (handle: UserHandle) => {
      const account = accounts.find((candidate) => candidate.handle === handle.toString() && candidate.active !== false);
      return account === undefined ? null : { userId: account.userId, handle: account.handle, displayName: account.displayName };
    }),
  };
}

function profileStore(): ProfileStore & { saveForActiveUser: ReturnType<typeof vi.fn> } {
  return {
    getAccountStatus: vi.fn(async () => "ACTIVE" as const),
    saveForActiveUser: vi.fn(async () => undefined),
  };
}

const profile = { displayName: "Marcus Lim", preferredSports: ["Tennis"], preferredRegions: ["West"] };

// Owner: Joseph (Jolingoes) — /use-cases/accounts (ADR-0021)
describe("UC1-01/UC1-03 user IDs", () => {
  describe("changing the user ID in Edit profile", () => {
    test("saves the user ID in its stored lower-case form", async () => {
      // Arrange
      const store = profileStore();

      // Act
      await new UpdateProfile(store).forUser("marcus", { ...profile, handle: " @Marcus_Lim " });

      // Assert
      expect(store.saveForActiveUser).toHaveBeenCalledExactlyOnceWith("marcus", { ...profile, handle: "marcus_lim" });
    });

    test("leaves the user ID unchanged when the edit has none", async () => {
      // Arrange
      const store = profileStore();

      // Act
      await new UpdateProfile(store).forUser("marcus", profile);

      // Assert
      expect(store.saveForActiveUser).toHaveBeenCalledExactlyOnceWith("marcus", profile);
    });

    test("refuses a malformed user ID without saving anything", async () => {
      // Arrange
      const store = profileStore();

      // Act & Assert
      await expect(new UpdateProfile(store).forUser("marcus", { ...profile, handle: "9lives" }))
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(store.saveForActiveUser).not.toHaveBeenCalled();
    });

    test("passes on the store's report that another account holds the user ID", async () => {
      // Arrange: uniqueness is decided by the database inside the guarded write.
      const store = profileStore();
      store.saveForActiveUser.mockRejectedValue(new DomainError("HANDLE_TAKEN", "The user ID is already taken"));

      // Act & Assert
      await expect(new UpdateProfile(store).forUser("marcus", { ...profile, handle: "taken_id" }))
        .rejects.toMatchObject({ code: "HANDLE_TAKEN" });
    });
  });

  describe("checking whether a user ID is free", () => {
    test("reports a free user ID as available", async () => {
      // Act
      const availability = await new CheckUserHandle(directory([MARCUS])).availability("marcus_tan");

      // Assert
      expect(availability).toBe("AVAILABLE");
    });

    test("reports a held user ID as taken, ignoring letter case and @", async () => {
      // Act
      const availability = await new CheckUserHandle(directory([MARCUS])).availability("@MARCUS_LIM");

      // Assert
      expect(availability).toBe("TAKEN");
    });

    test("reports a malformed user ID as invalid without reading the directory", async () => {
      // Arrange
      const users = directory([MARCUS]);

      // Act
      const availability = await new CheckUserHandle(users).availability("abc");

      // Assert
      expect(availability).toBe("INVALID");
      expect(users.isHandleFree).not.toHaveBeenCalled();
    });
  });

  describe("finding a player by exact user ID", () => {
    test("returns only the player's ID, user ID and name", async () => {
      // Act
      const found = await new FindUserByHandle(directory([MARCUS])).forHandle("@Marcus_Lim");

      // Assert
      expect(found).toEqual(MARCUS);
    });

    test("does not match part of a user ID", async () => {
      // Act & Assert
      await expect(new FindUserByHandle(directory([MARCUS])).forHandle("marcus"))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("does not find an inactive account", async () => {
      // Arrange
      const users = directory([{ ...MARCUS, active: false }]);

      // Act & Assert
      await expect(new FindUserByHandle(users).forHandle("marcus_lim")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("refuses a malformed user ID without reading the directory", async () => {
      // Arrange
      const users = directory([MARCUS]);

      // Act & Assert
      await expect(new FindUserByHandle(users).forHandle("bad id")).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(users.findActiveByHandle).not.toHaveBeenCalled();
    });
  });
});
