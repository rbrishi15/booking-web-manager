import {
  DomainError,
  GroupMembership,
  RegularGroup,
  type RegularGroupDetails,
} from "@/domain";
import { describe, expect, test } from "vitest";

describe("RegularGroup", () => {
  describe("Construction and membership", () => {
    test("constructor_WhenMembershipsAreEmpty_ThrowsDomainError", () => {
      // Arrange
      const details = groupDetails();

      // Act & Assert
      expect(() => new RegularGroup({ ...details, memberships: [] })).toThrow(
        DomainError,
      );
    });

    test("constructor_WhenMembershipsAreDuplicated_ThrowsDomainError", () => {
      // Arrange
      const details = groupDetails();

      // Act & Assert
      expect(
        () =>
          new RegularGroup({
            ...details,
            memberships: [...details.memberships, ...details.memberships],
          }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenOwnerIsNotAMember_ThrowsDomainError", () => {
      // Arrange
      const details = groupDetails();

      // Act & Assert
      expect(
        () => new RegularGroup({ ...details, ownerId: "missing" }),
      ).toThrow(DomainError);
    });

    test("constructor_WhenArchivedInvitationIsActive_ThrowsDomainError", () => {
      // Arrange
      const details = groupDetails();

      // Act & Assert
      expect(
        () => new RegularGroup({ ...details, status: "ARCHIVED" }),
      ).toThrow(DomainError);
    });

    test("memberships_WhenInputsAndOutputsAreMutated_PreservesMembersAndDates", () => {
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
  });

  describe("Joining and invitations", () => {
    test("join_WhenMemberJoinsAgain_PreservesSingleMembership", () => {
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

    test("join_WhenInvitationIsRevokedForExistingMember_ThrowsInvalidInvitation", () => {
      // Arrange
      const group = newGroup();
      group.revokeInvitation("owner");
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.join({
          userId: "owner",
          invitationToken: "first-token",
          now: now(),
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INVITATION" }));
      expect(groupState(group)).toEqual(before);
    });

    test("join_WhenTokenWasRotated_ThrowsInvalidInvitation", () => {
      // Arrange
      const group = newGroup();
      group.revokeInvitation("owner");
      group.rotateInvitation({
        actorId: "owner",
        invitationToken: "next-token",
      });
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.join({
          userId: "player",
          invitationToken: "first-token",
          now: now(),
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INVITATION" }));
      expect(groupState(group)).toEqual(before);
    });

    test("join_WhenRevokedInvitationIsRotated_AcceptsNewToken", () => {
      // Arrange
      const group = newGroup();
      group.revokeInvitation("owner");
      group.rotateInvitation({
        actorId: "owner",
        invitationToken: "next-token",
      });

      // Act
      const admission = group.join({
        userId: "player",
        invitationToken: "next-token",
        now: now(),
      });

      // Assert
      expect(admission).toBe("JOINED");
    });

    test("join_WhenGroupIsArchived_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.join({
          userId: "player",
          invitationToken: "first-token",
          now: now(),
        }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(groupState(group)).toEqual(before);
    });

    test("rotateInvitation_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.rotateInvitation({ actorId: "other", invitationToken: "new" }),
      ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
      expect(groupState(group)).toEqual(before);
    });

    test("rotateInvitation_WhenGroupIsArchived_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.rotateInvitation({ actorId: "owner", invitationToken: "new" }),
      ).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
      expect(groupState(group)).toEqual(before);
    });

    test("revokeInvitation_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() => group.revokeInvitation("other")).toThrow(
        expect.objectContaining({ code: "UNAUTHORIZED" }),
      );
      expect(groupState(group)).toEqual(before);
    });
  });

  describe("Owner management", () => {
    test("rename_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.rename({ actorId: "other", name: "New name" }),
      ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
      expect(groupState(group)).toEqual(before);
    });

    test("rename_WhenOwnerProvidesName_UpdatesName", () => {
      // Arrange
      const group = newGroup();

      // Act
      group.rename({ actorId: "owner", name: "Saturday tennis" });

      // Assert
      expect(group.name).toBe("Saturday tennis");
    });

    test("rename_WhenNameIsBlank_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() => group.rename({ actorId: "owner", name: " " })).toThrow(
        expect.objectContaining({ code: "INVALID_INPUT" }),
      );
      expect(groupState(group)).toEqual(before);
    });

    test("rename_WhenGroupIsArchived_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
      const before = groupState(group);

      // Act & Assert
      expect(() => group.rename({ actorId: "owner", name: "New" })).toThrow(
        expect.objectContaining({ code: "INVALID_STATE" }),
      );
      expect(groupState(group)).toEqual(before);
    });

    test("removeMember_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.removeMember({ actorId: "other", userId: "owner" }),
      ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
      expect(groupState(group)).toEqual(before);
    });

    test("removeMember_WhenOwnerRemovesAnotherMember_RetainsOwner", () => {
      // Arrange
      const group = newGroup();
      group.join({
        userId: "player",
        invitationToken: "first-token",
        now: now(),
      });

      // Act
      group.removeMember({ actorId: "owner", userId: "player" });

      // Assert
      expect(group.memberships).toHaveLength(1);
      expect(group.memberships[0]?.userId).toBe("owner");
    });

    test("removeMember_WhenTargetIsOwner_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.removeMember({ actorId: "owner", userId: "owner" }),
      ).toThrow(expect.objectContaining({ code: "OWNER_REMOVAL" }));
      expect(groupState(group)).toEqual(before);
    });

    test("removeMember_WhenMemberIsMissing_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.removeMember({ actorId: "owner", userId: "missing" }),
      ).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
      expect(groupState(group)).toEqual(before);
    });

    test("archive_WhenActorIsNotOwner_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.archive({ actorId: "other", unsettledLinkedSessions: 0 }),
      ).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
      expect(groupState(group)).toEqual(before);
    });

    test("archive_WhenLinkedSessionsAreUnsettled_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.archive({ actorId: "owner", unsettledLinkedSessions: 1 }),
      ).toThrow(expect.objectContaining({ code: "ACTIVE_OBLIGATIONS" }));
      expect(groupState(group)).toEqual(before);
    });

    test("archive_WhenLinkedSessionCountIsNegative_RejectsWithoutChangingState", () => {
      // Arrange
      const group = newGroup();
      const before = groupState(group);

      // Act & Assert
      expect(() =>
        group.archive({ actorId: "owner", unsettledLinkedSessions: -1 }),
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
      expect(groupState(group)).toEqual(before);
    });

    test("archive_WhenAllLinkedSessionsAreSettled_RetainsMembersAndIsIdempotent", () => {
      // Arrange
      const group = newGroup();

      // Act
      group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
      group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });

      // Assert
      expect(group.status).toBe("ARCHIVED");
      expect(group.invitationActive).toBe(false);
      expect(group.memberships).toHaveLength(1);
    });
  });
});

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

function groupState(group: RegularGroup) {
  return {
    name: group.name,
    invitationToken: group.invitationToken,
    invitationActive: group.invitationActive,
    memberships: group.memberships.map((member) => ({
      userId: member.userId,
      joinedAt: member.joinedAt,
    })),
    status: group.status,
  };
}
