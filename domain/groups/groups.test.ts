import { describe, expect, test } from "vitest";
import { DomainError } from "../shared/errors";
import { GroupMembership } from "./group-membership";
import { RegularGroup } from "./regular-group";

const now = () => new Date("2026-09-15T00:00:00Z");
const newGroup = () =>
  RegularGroup.create({
    groupId: "group",
    ownerId: "owner",
    name: "Sunday badminton",
    invitationToken: "first-token",
    now: now(),
  });

function expectRejectedUnchanged<T>(
  aggregate: { snapshot(): T },
  operation: () => unknown,
  code: string,
): void {
  const before = aggregate.snapshot();
  expect(operation).toThrow(DomainError);
  expect(operation).toThrow(expect.objectContaining({ code }));
  expect(aggregate.snapshot()).toEqual(before);
}

describe("RegularGroup aggregate", () => {
  test("seeds owner membership and handles repeated joins without duplicates", () => {
    const group = newGroup();
    expect(group.status).toBe("ACTIVE");
    expect(group.memberships.map((member) => member.userId)).toEqual(["owner"]);
    expect(
      group.join({
        userId: "player",
        invitationToken: "first-token",
        now: now(),
      }),
    ).toBe("JOINED");
    expect(
      group.join({
        userId: "player",
        invitationToken: "first-token",
        now: now(),
      }),
    ).toBe("ALREADY_MEMBER");
    expect(group.memberships).toHaveLength(2);
  });

  test("revocation and rotation invalidate previous invitations, including for existing members", () => {
    const group = newGroup();
    group.revokeInvitation("owner");
    expectRejectedUnchanged(
      group,
      () =>
        group.join({
          userId: "owner",
          invitationToken: "first-token",
          now: now(),
        }),
      "INVALID_INVITATION",
    );
    group.rotateInvitation({ actorId: "owner", invitationToken: "next-token" });
    expectRejectedUnchanged(
      group,
      () =>
        group.join({
          userId: "player",
          invitationToken: "first-token",
          now: now(),
        }),
      "INVALID_INVITATION",
    );
    expect(
      group.join({
        userId: "player",
        invitationToken: "next-token",
        now: now(),
      }),
    ).toBe("JOINED");
  });

  test("only the owner manages membership, invitations, name, and archive", () => {
    const group = newGroup();
    const operations = [
      () => group.rename({ actorId: "other", name: "New name" }),
      () => group.removeMember({ actorId: "other", userId: "owner" }),
      () =>
        group.rotateInvitation({ actorId: "other", invitationToken: "new" }),
      () => group.revokeInvitation("other"),
      () => group.archive({ actorId: "other", unsettledLinkedSessions: 0 }),
    ];
    for (const operation of operations)
      expectRejectedUnchanged(group, operation, "UNAUTHORIZED");
  });

  test("owner may rename and remove others but never remove themselves", () => {
    const group = newGroup();
    group.join({
      userId: "player",
      invitationToken: "first-token",
      now: now(),
    });
    group.rename({ actorId: "owner", name: "Saturday tennis" });
    group.removeMember({ actorId: "owner", userId: "player" });
    expect(group.name).toBe("Saturday tennis");
    expect(group.memberships).toHaveLength(1);
    expectRejectedUnchanged(
      group,
      () => group.removeMember({ actorId: "owner", userId: "owner" }),
      "OWNER_REMOVAL",
    );
    expectRejectedUnchanged(
      group,
      () => group.removeMember({ actorId: "owner", userId: "missing" }),
      "NOT_FOUND",
    );
    expectRejectedUnchanged(
      group,
      () => group.rename({ actorId: "owner", name: " " }),
      "INVALID_INPUT",
    );
  });

  test("archive waits for settled links, retains memberships, and disables future writes", () => {
    const group = newGroup();
    expectRejectedUnchanged(
      group,
      () => group.archive({ actorId: "owner", unsettledLinkedSessions: 1 }),
      "ACTIVE_OBLIGATIONS",
    );
    expectRejectedUnchanged(
      group,
      () => group.archive({ actorId: "owner", unsettledLinkedSessions: -1 }),
      "INVALID_INPUT",
    );
    group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
    group.archive({ actorId: "owner", unsettledLinkedSessions: 0 });
    expect(group.status).toBe("ARCHIVED");
    expect(group.invitationActive).toBe(false);
    expect(group.memberships).toHaveLength(1);
    expectRejectedUnchanged(
      group,
      () =>
        group.join({
          userId: "player",
          invitationToken: "first-token",
          now: now(),
        }),
      "INVALID_STATE",
    );
    expectRejectedUnchanged(
      group,
      () => group.rename({ actorId: "owner", name: "New" }),
      "INVALID_STATE",
    );
    expectRejectedUnchanged(
      group,
      () =>
        group.rotateInvitation({ actorId: "owner", invitationToken: "new" }),
      "INVALID_STATE",
    );
  });

  test("rehydration and snapshots protect child membership dates and collections", () => {
    const group = newGroup();
    const snapshot = group.snapshot();
    const reloaded = RegularGroup.reconstitute(snapshot);
    snapshot.memberships[0]?.joinedAt.setUTCFullYear(2000);
    (snapshot.memberships as unknown[]).pop();
    group.memberships[0]?.joinedAt.setUTCFullYear(2000);
    (group.memberships as GroupMembership[]).pop();
    expect(group.memberships).toHaveLength(1);
    expect(reloaded.memberships).toHaveLength(1);
    expect(group.memberships[0]?.joinedAt).toEqual(now());
    expect(reloaded.memberships[0]?.joinedAt).toEqual(now());
  });

  test("reconstitution rejects empty, duplicate, ownerless, and inconsistently archived groups", () => {
    const snapshot = newGroup().snapshot();
    expect(() =>
      RegularGroup.reconstitute({ ...snapshot, memberships: [] }),
    ).toThrow(DomainError);
    expect(() =>
      RegularGroup.reconstitute({
        ...snapshot,
        memberships: [...snapshot.memberships, ...snapshot.memberships],
      }),
    ).toThrow(DomainError);
    expect(() =>
      RegularGroup.reconstitute({ ...snapshot, ownerId: "missing" }),
    ).toThrow(DomainError);
    expect(() =>
      RegularGroup.reconstitute({ ...snapshot, status: "ARCHIVED" }),
    ).toThrow(DomainError);
  });
});
describe("GroupMembership child entity", () => {
  test("copies all mutable timestamps and rejects invalid values", () => {
    const joinedAt = now();
    const member = GroupMembership.create({ userId: "owner", joinedAt });
    joinedAt.setUTCFullYear(2000);
    member.joinedAt.setUTCFullYear(2000);
    member.snapshot().joinedAt.setUTCFullYear(2000);
    expect(member.joinedAt).toEqual(now());
    expect(() =>
      GroupMembership.create({
        userId: "owner",
        joinedAt: new Date("invalid"),
      }),
    ).toThrow(DomainError);
    expect(() =>
      GroupMembership.create({ userId: " ", joinedAt: now() }),
    ).toThrow(DomainError);
  });
});
