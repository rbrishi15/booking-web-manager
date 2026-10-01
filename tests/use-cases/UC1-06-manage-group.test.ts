import { describe, expect, test } from "vitest";
import { DomainError } from "@/domain";
import { ManageGroup } from "@/use-cases/groups/manage-group";
import { inMemoryGroupDependencies } from "./support/in-memory-groups";

const OWNER = "owner-marcus";
const FRIEND = "friend-aisha";
const STRANGER = "stranger-ben";

/** A ManageGroup over an empty in-memory store, plus one group owned by OWNER. */
async function withGroup(options: { readonly unsettledLinkedSessions?: number } = {}) {
  const { deps, rows } = inMemoryGroupDependencies(options);
  const manageGroup = new ManageGroup(deps);
  const group = await manageGroup.create({ ownerId: OWNER, name: "Weekend Tennis Crew" });
  return { manageGroup, rows, group };
}

/** Runs an action that should fail and returns the DomainError code it failed with. */
async function errorCode(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error("Expected a DomainError, but the action succeeded");
}

// Owner: Joseph (Jolingoes) — /app/groups
describe("UC1-06 Manage Group", () => {
  describe("creating a group", () => {
    test("creates a group", async () => {
      // Arrange + Act
      const { manageGroup, group } = await withGroup();

      // Assert
      const saved = await manageGroup.viewAsMember({ actorId: OWNER, groupId: group.groupId });
      expect(saved.name).toBe("Weekend Tennis Crew");
      expect(saved.ownerId).toBe(OWNER);
      expect(saved.memberships.map((member) => member.userId)).toEqual([OWNER]);
      expect(saved.invitationActive).toBe(true);
    });

    test("rejects a blank name", async () => {
      // Arrange
      const { deps } = inMemoryGroupDependencies();
      const manageGroup = new ManageGroup(deps);

      // Act
      const code = await errorCode(() => manageGroup.create({ ownerId: OWNER, name: "   " }));

      // Assert
      expect(code).toBe("INVALID_INPUT");
    });

    test("lists only the groups the user belongs to", async () => {
      // Arrange
      const { manageGroup } = await withGroup();
      await manageGroup.create({ ownerId: STRANGER, name: "Someone else's group" });

      // Act
      const mine = await manageGroup.listMine({ actorId: OWNER });

      // Assert
      expect(mine.map((group) => group.name)).toEqual(["Weekend Tennis Crew"]);
    });
  });

  describe("invitation links", () => {
    test("generates a working invitation link", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();

      // Act
      const { result } = await manageGroup.join({ userId: FRIEND, invitationToken: group.invitationToken });

      // Assert
      expect(result).toBe("JOINED");
      const saved = await manageGroup.viewAsMember({ actorId: FRIEND, groupId: group.groupId });
      expect(saved.memberships.map((member) => member.userId)).toEqual([OWNER, FRIEND]);
    });

    test("joining twice is harmless", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();
      await manageGroup.join({ userId: FRIEND, invitationToken: group.invitationToken });

      // Act
      const { result } = await manageGroup.join({ userId: FRIEND, invitationToken: group.invitationToken });

      // Assert
      expect(result).toBe("ALREADY_MEMBER");
    });

    test("rejects an unknown link", async () => {
      // Arrange
      const { manageGroup } = await withGroup();

      // Act
      const code = await errorCode(() => manageGroup.join({ userId: FRIEND, invitationToken: "made-up" }));

      // Assert
      expect(code).toBe("INVALID_INVITATION");
    });

    test("a revoked link stops working", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();
      await manageGroup.revokeInvitation({ actorId: OWNER, groupId: group.groupId });

      // Act
      const code = await errorCode(() =>
        manageGroup.join({ userId: FRIEND, invitationToken: group.invitationToken }),
      );

      // Assert
      expect(code).toBe("INVALID_INVITATION");
      expect(await errorCode(() => manageGroup.previewInvitation(group.invitationToken))).toBe("INVALID_INVITATION");
    });

    test("a new link replaces the old one", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();

      // Act
      const newToken = await manageGroup.rotateInvitation({ actorId: OWNER, groupId: group.groupId });

      // Assert
      expect(newToken).not.toBe(group.invitationToken);
      expect(await errorCode(() => manageGroup.join({ userId: FRIEND, invitationToken: group.invitationToken }))).toBe(
        "INVALID_INVITATION",
      );
      const { result } = await manageGroup.join({ userId: FRIEND, invitationToken: newToken });
      expect(result).toBe("JOINED");
    });
  });

  describe("membership management", () => {
    test("adds and removes members via the invitation link / membership management", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();
      await manageGroup.join({ userId: FRIEND, invitationToken: group.invitationToken });

      // Act
      await manageGroup.removeMember({ actorId: OWNER, groupId: group.groupId, userId: FRIEND });

      // Assert
      const saved = await manageGroup.viewAsMember({ actorId: OWNER, groupId: group.groupId });
      expect(saved.memberships.map((member) => member.userId)).toEqual([OWNER]);
    });

    test("the owner cannot be removed", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();

      // Act
      const code = await errorCode(() =>
        manageGroup.removeMember({ actorId: OWNER, groupId: group.groupId, userId: OWNER }),
      );

      // Assert
      expect(code).toBe("OWNER_REMOVAL");
    });

    test.each([
      ["remove a member", (m: ManageGroup, groupId: string) => m.removeMember({ actorId: FRIEND, groupId, userId: OWNER })],
      ["rename the group", (m: ManageGroup, groupId: string) => m.rename({ actorId: FRIEND, groupId, name: "Mine now" })],
      ["issue a new link", (m: ManageGroup, groupId: string) => m.rotateInvitation({ actorId: FRIEND, groupId })],
      ["turn the link off", (m: ManageGroup, groupId: string) => m.revokeInvitation({ actorId: FRIEND, groupId })],
      ["archive the group", (m: ManageGroup, groupId: string) => m.archive({ actorId: FRIEND, groupId })],
    ])("a member who is not the owner cannot %s", async (_action, act) => {
      // Arrange
      const { manageGroup, group } = await withGroup();
      await manageGroup.join({ userId: FRIEND, invitationToken: group.invitationToken });

      // Act
      const code = await errorCode(() => act(manageGroup, group.groupId));

      // Assert
      expect(code).toBe("UNAUTHORIZED");
    });

    test("non-members cannot see a group", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();

      // Act
      const code = await errorCode(() => manageGroup.viewAsMember({ actorId: STRANGER, groupId: group.groupId }));

      // Assert
      expect(code).toBe("NOT_FOUND");
    });
  });

  describe("archiving", () => {
    test("archives a group with no unsettled sessions and turns its link off", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup();

      // Act
      await manageGroup.archive({ actorId: OWNER, groupId: group.groupId });

      // Assert
      const saved = await manageGroup.viewAsMember({ actorId: OWNER, groupId: group.groupId });
      expect(saved.status).toBe("ARCHIVED");
      expect(saved.invitationActive).toBe(false);
    });

    test("waits until the group's sessions are settled", async () => {
      // Arrange
      const { manageGroup, group } = await withGroup({ unsettledLinkedSessions: 1 });

      // Act
      const code = await errorCode(() => manageGroup.archive({ actorId: OWNER, groupId: group.groupId }));

      // Assert
      expect(code).toBe("ACTIVE_OBLIGATIONS");
    });
  });
});
