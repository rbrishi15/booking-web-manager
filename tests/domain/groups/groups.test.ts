import {
  DomainError,
  GroupMembership,
  RegularGroup,
  type RegularGroupDetails,
} from "@/domain";
import { describe, expect, test } from "vitest";

const now = () => new Date("2026-09-15T00:00:00Z");
const newGroup = () =>
  RegularGroup.create({
    groupId: "group",
    ownerId: "owner",
    name: "Sunday badminton",
    invitationToken: "first-token",
    now: now(),
  });

function groupDetails(
  overrides: Partial<RegularGroupDetails> = {},
): RegularGroupDetails {
  return {
    groupId: "group",
    ownerId: "owner",
    name: "Badminton",
    invitationToken: "invite",
    invitationActive: true,
    status: "ACTIVE",
    memberships: [new GroupMembership({ userId: "owner", joinedAt: now() })],
    ...overrides,
  };
}

function captureError(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("RegularGroup aggregate", () => {
  test("seeds owner membership and handles repeated joins without duplicates", () => {
    // Arrange
    const group = newGroup();

    // Act
    const firstJoin = group.join({
      userId: "player",
      invitationToken: "first-token",
      now: now(),
    });
    const repeatedJoin = group.join({
      userId: "player",
      invitationToken: "first-token",
      now: now(),
    });

    // Assert
    expect(group.status).toBe("ACTIVE");
    expect(group.memberships.map((member) => member.userId)).toEqual([
      "owner",
      "player",
    ]);
    expect(firstJoin).toBe("JOINED");
    expect(repeatedJoin).toBe("ALREADY_MEMBER");
    expect(group.memberships).toHaveLength(2);
  });

  test("revocation and rotation invalidate previous invitations, including for existing members", () => {
    // Arrange
    const group = newGroup();

    // Act
    group.revokeInvitation("owner");
    const revokedJoin = () =>
      group.join({
        userId: "owner",
        invitationToken: "first-token",
        now: now(),
      });
    group.rotateInvitation({ actorId: "owner", invitationToken: "next-token" });
    const staleTokenJoin = () =>
      group.join({
        userId: "player",
        invitationToken: "first-token",
        now: now(),
      });
    const currentTokenJoin = group.join({
      userId: "player",
      invitationToken: "next-token",
      now: now(),
    });

    // Assert
    expect(revokedJoin).toThrow(
      expect.objectContaining({ code: "INVALID_INVITATION" }),
    );
    expect(staleTokenJoin).toThrow(
      expect.objectContaining({ code: "INVALID_INVITATION" }),
    );
    expect(currentTokenJoin).toBe("JOINED");
  });

  test("only the owner manages membership, invitations, name, and archive", () => {
    // Arrange
    const group = newGroup();
    const operations = [
      () => group.rename({ actorId: "other", name: "New name" }),
      () => group.removeMember({ actorId: "other", userId: "owner" }),
      () =>
        group.rotateInvitation({ actorId: "other", invitationToken: "new" }),
      () => group.revokeInvitation("other"),
      () => group.archive({ actorId: "other", unsettledLinkedSessions: 0 }),
    ];

    // Act
    const rejected = operations.map((operation) => {
      try {
        operation();
        return false;
      } catch (error) {
        return error;
      }
    });

    // Assert
    expect(rejected).toHaveLength(5);
    for (const error of rejected) {
      expect(error).toEqual(expect.objectContaining({ code: "UNAUTHORIZED" }));
    }
    expect(group.name).toBe(newGroup().name);
    expect(group.invitationToken).toBe(newGroup().invitationToken);
    expect(group.invitationActive).toBe(true);
    expect(group.memberships.map((member) => member.userId)).toEqual(["owner"]);
    expect(group.status).toBe("ACTIVE");
  });

  test("owner may rename and remove others but never remove themselves", () => {
    // Arrange
    const group = newGroup();

    // Act
    group.join({
      userId: "player",
      invitationToken: "first-token",
      now: now(),
    });
    group.rename({ actorId: "owner", name: "Saturday tennis" });
    group.removeMember({ actorId: "owner", userId: "player" });
    const removeOwner = () =>
      group.removeMember({ actorId: "owner", userId: "owner" });
    const removeMissing = () =>
      group.removeMember({ actorId: "owner", userId: "missing" });
    const renameBlank = () => group.rename({ actorId: "owner", name: " " });

    // Assert
    expect(group.name).toBe("Saturday tennis");
    expect(group.memberships).toHaveLength(1);
    expect(removeOwner).toThrow(
      expect.objectContaining({ code: "OWNER_REMOVAL" }),
    );
    expect(removeMissing).toThrow(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    expect(renameBlank).toThrow(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
  });

  test("archive waits for settled links, retains memberships, and disables future writes", () => {
    // Arrange
    const group = newGroup();

    // Act
    const unsettledArchive = () =>
      group.archive({ actorId: "owner", unsettledLinkedSessions: 1 });
    const negativeArchive = () =>
      group.archive({ actorId: "owner", unsettledLinkedSessions: -1 });
    const unsettledArchiveError = captureError(unsettledArchive);
    const negativeArchiveError = captureError(negativeArchive);
    group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
    group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
    const joinArchived = () =>
      group.join({
        userId: "player",
        invitationToken: "first-token",
        now: now(),
      });
    const renameArchived = () =>
      group.rename({ actorId: "owner", name: "New" });
    const rotateArchived = () =>
      group.rotateInvitation({ actorId: "owner", invitationToken: "new" });

    // Assert
    expect(unsettledArchiveError).toEqual(
      expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }),
    );
    expect(negativeArchiveError).toEqual(
      expect.objectContaining({ code: "INVALID_INPUT" }),
    );
    expect(group.status).toBe("ARCHIVED");
    expect(group.invitationActive).toBe(false);
    expect(group.memberships).toHaveLength(1);
    expect(joinArchived).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
    expect(renameArchived).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
    expect(rotateArchived).toThrow(
      expect.objectContaining({ code: "INVALID_STATE" }),
    );
  });

  test("constructors and getters protect child membership dates and collections", () => {
    // Arrange
    const group = newGroup();
    const memberships = [
      new GroupMembership({ userId: "owner", joinedAt: now() }),
    ];
    const details = groupDetails({ memberships });

    // Act
    const constructed = new RegularGroup(details);
    memberships[0]?.joinedAt.setUTCFullYear(2000);
    memberships.pop();
    group.memberships[0]?.joinedAt.setUTCFullYear(2000);
    (group.memberships as GroupMembership[]).pop();

    // Assert
    expect(group.memberships).toHaveLength(1);
    expect(constructed.memberships).toHaveLength(1);
    expect(group.memberships[0]?.joinedAt).toEqual(now());
    expect(constructed.memberships[0]?.joinedAt).toEqual(now());
  });

  test("constructors reject empty, duplicate, ownerless, and inconsistently archived groups", () => {
    // Arrange
    const details = groupDetails();
    // Act
    const empty = () => new RegularGroup({ ...details, memberships: [] });
    const duplicate = () =>
      new RegularGroup({
        ...details,
        memberships: [...details.memberships, ...details.memberships],
      });
    const ownerless = () =>
      new RegularGroup({ ...details, ownerId: "missing" });
    const archived = () => new RegularGroup({ ...details, status: "ARCHIVED" });

    // Assert
    expect(empty).toThrow(DomainError);
    expect(duplicate).toThrow(DomainError);
    expect(ownerless).toThrow(DomainError);
    expect(archived).toThrow(DomainError);
  });
});
describe("GroupMembership child entity", () => {
  test("copies all mutable timestamps and rejects invalid values", () => {
    // Arrange
    const joinedAt = now();
    const member = new GroupMembership({ userId: "owner", joinedAt });

    // Act
    joinedAt.setUTCFullYear(2000);
    member.joinedAt.setUTCFullYear(2000);
    const invalidDate = () =>
      new GroupMembership({
        userId: "owner",
        joinedAt: new Date("invalid"),
      });
    const blankUser = () =>
      new GroupMembership({ userId: " ", joinedAt: now() });

    // Assert
    expect(member.joinedAt).toEqual(now());
    expect(invalidDate).toThrow(DomainError);
    expect(blankUser).toThrow(DomainError);
  });
});
