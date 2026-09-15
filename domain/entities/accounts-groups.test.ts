import { describe, expect, test } from "vitest";
import { DomainError } from "../errors";
import { Money } from "../value-objects/money";
import { GroupMembership } from "./group-membership";
import { PayoutAccount } from "./payout-account";
import { RegularGroup } from "./regular-group";
import { type DeactivationFacts, User } from "./user";

const now = () => new Date("2026-09-15T00:00:00Z");
const newUser = () =>
  User.create({ userId: "owner", email: "owner@example.com" });
const newGroup = () =>
  RegularGroup.create({
    groupId: "group",
    ownerId: "owner",
    name: "Sunday badminton",
    invitationToken: "first-token",
    now: now(),
  });
const clearFacts = (): DeactivationFacts => ({
  availableBalance: Money.fromCents(0),
  heldBalance: Money.fromCents(0),
  activeCommitments: 0,
  unsettledOwnedSessions: 0,
  pendingPayouts: 0,
  activeOwnedGroups: 0,
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

describe("User aggregate", () => {
  test("creates an active account and changes profile and preferences", () => {
    const user = newUser();
    expect(user.accountStatus).toBe("ACTIVE");
    expect(user.preferredSports.size).toBe(0);
    user.updateProfile({ email: "new@example.com" });
    user.updatePreferences({
      preferredSports: new Set(["Tennis"]),
      preferredRegions: new Set(["West"]),
    });
    expect(user.email).toBe("new@example.com");
    expect([...user.preferredSports]).toEqual(["Tennis"]);
    expect([...user.preferredRegions]).toEqual(["West"]);
  });

  test("copies incoming, outgoing, and reconstituted preference sets", () => {
    const sports = new Set(["Tennis"]);
    const user = User.create({
      userId: "owner",
      email: "owner@example.com",
      preferredSports: sports,
    });
    sports.clear();
    (user.preferredSports as Set<string>).clear();
    const snapshot = user.snapshot();
    const reloaded = User.reconstitute(snapshot);
    (snapshot.preferredSports as Set<string>).clear();
    expect([...user.preferredSports]).toEqual(["Tennis"]);
    expect([...reloaded.preferredSports]).toEqual(["Tennis"]);
  });

  test("rejects invalid profile and preference updates before changing state", () => {
    const user = newUser();
    expectRejectedUnchanged(
      user,
      () => user.updateProfile({ email: " " }),
      "INVALID_INPUT",
    );
    expectRejectedUnchanged(
      user,
      () =>
        user.updatePreferences({
          preferredSports: new Set(["Tennis"]),
          preferredRegions: new Set([" "]),
        }),
      "INVALID_INPUT",
    );
  });

  test("payout setup produces a frozen usable destination only after completion", () => {
    const user = newUser();
    expect(() => user.payoutDestination()).toThrow(
      expect.objectContaining({ code: "PAYOUT_ACCOUNT_NOT_READY" }),
    );
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    expect(user.payoutAccount?.setupStatus).toBe("PENDING");
    expect(() => user.payoutDestination()).toThrow(DomainError);
    const pending = user.payoutAccount;
    user.completePayoutSetup("bank");
    expect(pending?.setupStatus).toBe("PENDING");
    expect(user.payoutAccount?.setupStatus).toBe("COMPLETE");
    expect(user.payoutDestination()).toEqual({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
      bankAccountReference: "bank",
    });
    expect(Object.isFrozen(user.payoutDestination())).toBe(true);
    expectRejectedUnchanged(
      user,
      () => user.failPayoutSetup(),
      "INVALID_STATE",
    );
    expectRejectedUnchanged(
      user,
      () => user.completePayoutSetup("different-bank"),
      "INVALID_STATE",
    );
  });

  test("failed payout setup can restart but pending setup cannot be overwritten", () => {
    const user = newUser();
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    expectRejectedUnchanged(
      user,
      () =>
        user.beginPayoutSetup({
          payoutAccountId: "other",
          providerAccountReference: "different",
        }),
      "INVALID_STATE",
    );
    user.failPayoutSetup();
    expect(user.payoutAccount?.setupStatus).toBe("FAILED");
    user.beginPayoutSetup({
      payoutAccountId: "replacement",
      providerAccountReference: "provider-2",
    });
    user.completePayoutSetup("bank-2");
    expect(user.payoutDestination().payoutAccountId).toBe("replacement");
  });

  test("setup commands require an existing setup and valid bank reference", () => {
    const user = newUser();
    expectRejectedUnchanged(
      user,
      () => user.completePayoutSetup("bank"),
      "PAYOUT_ACCOUNT_NOT_READY",
    );
    expectRejectedUnchanged(
      user,
      () => user.failPayoutSetup(),
      "PAYOUT_ACCOUNT_NOT_READY",
    );
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    expectRejectedUnchanged(
      user,
      () => user.completePayoutSetup(" "),
      "INVALID_INPUT",
    );
  });

  test.each(["availableBalance", "heldBalance"] as const)(
    "requires zero %s for deactivation",
    (field) => {
      const user = newUser();
      expectRejectedUnchanged(
        user,
        () => user.deactivate({ ...clearFacts(), [field]: Money.fromCents(1) }),
        "ACTIVE_OBLIGATIONS",
      );
    },
  );

  test.each([
    "activeCommitments",
    "unsettledOwnedSessions",
    "pendingPayouts",
    "activeOwnedGroups",
  ] as const)("checks %s before deactivation", (field) => {
    const user = newUser();
    expectRejectedUnchanged(
      user,
      () => user.deactivate({ ...clearFacts(), [field]: 1 }),
      "ACTIVE_OBLIGATIONS",
    );
    expectRejectedUnchanged(
      user,
      () => user.deactivate({ ...clearFacts(), [field]: -1 }),
      "INVALID_INPUT",
    );
    expectRejectedUnchanged(
      user,
      () => user.deactivate({ ...clearFacts(), [field]: 0.5 }),
      "INVALID_INPUT",
    );
  });

  test("deactivation anonymises profile, retains financial identity, and is repeatable", () => {
    const user = newUser();
    user.updatePreferences({
      preferredSports: new Set(["Tennis"]),
      preferredRegions: new Set(["West"]),
    });
    user.beginPayoutSetup({
      payoutAccountId: "account",
      providerAccountReference: "provider",
    });
    user.completePayoutSetup("bank");
    user.deactivate(clearFacts());
    user.deactivate(clearFacts());
    expect(user.accountStatus).toBe("INACTIVE");
    expect(user.email).toBeNull();
    expect(user.preferredSports.size).toBe(0);
    expect(user.preferredRegions.size).toBe(0);
    expect(user.payoutAccount?.bankAccountReference).toBe("bank");
    expect(User.reconstitute(user.snapshot()).snapshot()).toEqual(
      user.snapshot(),
    );
    expectRejectedUnchanged(
      user,
      () => user.updateProfile({ email: "new@example.com" }),
      "INACTIVE_ACCOUNT",
    );
    expectRejectedUnchanged(
      user,
      () =>
        user.updatePreferences({
          preferredSports: new Set(),
          preferredRegions: new Set(),
        }),
      "INACTIVE_ACCOUNT",
    );
    expect(() => user.payoutDestination()).toThrow(
      expect.objectContaining({ code: "INACTIVE_ACCOUNT" }),
    );
  });

  test("reconstitution rejects foreign payout accounts and inconsistent account state", () => {
    const snapshot = newUser().snapshot();
    const payoutAccount = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "other-user",
      providerAccountReference: "provider",
    }).snapshot();
    expect(() => User.reconstitute({ ...snapshot, payoutAccount })).toThrow(
      DomainError,
    );
    expect(() =>
      User.reconstitute({ ...snapshot, accountStatus: "INACTIVE" }),
    ).toThrow(DomainError);
    expect(() => User.reconstitute({ ...snapshot, email: null })).toThrow(
      DomainError,
    );
  });
});

describe("PayoutAccount child entity", () => {
  test("transitions are immutable and completed setup accepts matching duplicate confirmation", () => {
    const pending = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
    });
    const completed = pending.completeSetup("bank");
    expect(pending.setupStatus).toBe("PENDING");
    expect(completed.completeSetup("bank").snapshot()).toEqual(
      completed.snapshot(),
    );
    expect(PayoutAccount.reconstitute(completed.snapshot()).snapshot()).toEqual(
      completed.snapshot(),
    );
    expect(() => pending.failSetup().completeSetup("bank")).toThrow(
      DomainError,
    );
  });

  test("reconstitution validates bank details against setup status", () => {
    const snapshot = PayoutAccount.create({
      payoutAccountId: "account",
      userId: "owner",
      providerAccountReference: "provider",
    }).snapshot();
    expect(() =>
      PayoutAccount.reconstitute({ ...snapshot, setupStatus: "COMPLETE" }),
    ).toThrow(DomainError);
    expect(() =>
      PayoutAccount.reconstitute({ ...snapshot, bankAccountReference: "bank" }),
    ).toThrow(DomainError);
  });
});

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
