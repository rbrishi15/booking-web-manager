import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError, RegularGroup } from "@/domain";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseGroupStore } from "@/lib/supabase/group-store";
import { GroupChangedError } from "@/use-cases/groups/manage-group";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const OWNER = "00000000-0000-4000-8000-00000000000a";
const JOINER = "00000000-0000-4000-8000-00000000000b";
const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const JOINED_AT = "2026-09-30T08:00:00.000Z";

type Call = readonly [method: string, ...args: unknown[]];

/** A regular_groups row as the store selects it, at the given version. */
function groupRow(version: number) {
  return {
    group_id: GROUP_ID,
    owner_id: OWNER,
    name: "Weekend Tennis",
    invitation_token: "token-1",
    invitation_active: true,
    status: "ACTIVE",
    version,
    group_memberships: [{ user_id: OWNER, joined_at: JOINED_AT }],
  };
}

/**
 * A stand-in for the Supabase admin client: `from()` queries record their calls and resolve to
 * `select`; `rpc()` calls are recorded and resolve to `rpc`.
 */
function fakeAdmin(results: { readonly select?: unknown; readonly rpc?: unknown }) {
  const queries: { table: string; calls: Call[] }[] = [];
  const rpc = vi.fn(async () => results.rpc);
  const client = {
    rpc,
    from(table: string) {
      const query = { table, calls: [] as Call[] };
      queries.push(query);
      const builder: object = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "then") {
              return (resolve: (value: unknown) => void) => resolve(results.select);
            }
            return (...args: unknown[]) => {
              query.calls.push([String(property), ...args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(client as never);
  return { queries, rpc };
}

describe("supabaseGroupStore (UC1-06)", () => {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockReset();
  });

  test("saves a new group and its owner's membership in one call", async () => {
    // Arrange
    const { rpc } = fakeAdmin({ rpc: { data: 0, error: null } });
    const group = RegularGroup.create({
      groupId: GROUP_ID,
      ownerId: OWNER,
      name: "Weekend Tennis",
      invitationToken: "token-1",
      now: new Date(JOINED_AT),
    });

    // Act
    await supabaseGroupStore().groups.save(group);

    // Assert
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "save_regular_group",
      expect.objectContaining({
        p_expected_version: null,
        p_added_members: [{ user_id: OWNER, joined_at: JOINED_AT }],
        p_removed_members: [],
      }),
    );
  });

  test("saves a join against the version the group was read at", async () => {
    // Arrange
    const { rpc } = fakeAdmin({ select: { data: groupRow(4), error: null }, rpc: { data: 5, error: null } });
    const { groups } = supabaseGroupStore();
    const group = (await groups.get(GROUP_ID))!;
    group.join({ userId: JOINER, invitationToken: "token-1", now: new Date(JOINED_AT) });

    // Act
    await groups.save(group);

    // Assert
    expect(rpc).toHaveBeenCalledWith(
      "save_regular_group",
      expect.objectContaining({
        p_expected_version: 4,
        p_invitation_active: true,
        p_added_members: [{ user_id: JOINER, joined_at: JOINED_AT }],
      }),
    );
  });

  test("reports GroupChangedError when someone saved the group after it was read", async () => {
    // Arrange: save_regular_group found a newer version (serialization failure).
    fakeAdmin({
      select: { data: groupRow(4), error: null },
      rpc: { data: null, error: { code: "40001", message: "GROUP_CHANGED" } },
    });
    const { groups } = supabaseGroupStore();
    const group = (await groups.get(GROUP_ID))!;
    group.join({ userId: JOINER, invitationToken: "token-1", now: new Date(JOINED_AT) });

    // Act & Assert
    await expect(groups.save(group)).rejects.toBeInstanceOf(GroupChangedError);
  });

  test("reports ACTIVE_OBLIGATIONS when the database refuses to archive a group with unsettled sessions", async () => {
    // Arrange: save_regular_group's own SQLSTATE for "linked session still unsettled".
    fakeAdmin({
      select: { data: groupRow(4), error: null },
      rpc: { data: null, error: { code: "GRP01", message: "ACTIVE_OBLIGATIONS" } },
    });
    const { groups } = supabaseGroupStore();
    const group = (await groups.get(GROUP_ID))!;
    group.archive({ actorId: OWNER, unsettledLinkedSessions: 0 });

    // Act
    const attempt = groups.save(group);

    // Assert: the owner is told about the sessions, not that someone else changed the group.
    await expect(attempt).rejects.toBeInstanceOf(DomainError);
    await expect(attempt).rejects.toMatchObject({ code: "ACTIVE_OBLIGATIONS" });
  });

  test("counts the group's unsettled linked sessions through the database", async () => {
    // Arrange
    const { rpc } = fakeAdmin({ rpc: { data: 1, error: null } });

    // Act
    const count = await supabaseGroupStore().queries.countUnsettledLinkedSessions(GROUP_ID);

    // Assert
    expect(count).toBe(1);
    expect(rpc).toHaveBeenCalledWith("count_unsettled_linked_sessions", { p_group_id: GROUP_ID });
  });

  test("reports INACTIVE_ACCOUNT when deactivation wins before a group save", async () => {
    fakeAdmin({ rpc: { data: null, error: { code: "GRP02", message: "INACTIVE_ACCOUNT" } } });
    const group = RegularGroup.create({
      groupId: GROUP_ID, ownerId: OWNER, name: "Weekend Tennis",
      invitationToken: "token-1", now: new Date(JOINED_AT),
    });

    await expect(supabaseGroupStore().groups.save(group)).rejects.toMatchObject({
      name: "DomainError", code: "INACTIVE_ACCOUNT",
    });
  });

  test("passes on a database error while counting linked sessions", async () => {
    // Arrange
    fakeAdmin({ rpc: { data: null, error: { code: "57014", message: "canceling statement" } } });

    // Act
    const attempt = supabaseGroupStore().queries.countUnsettledLinkedSessions(GROUP_ID);

    // Assert
    await expect(attempt).rejects.toMatchObject({ code: "57014" });
  });
});
