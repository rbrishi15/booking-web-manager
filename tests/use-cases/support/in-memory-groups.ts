import { GroupMembership, RegularGroup, type UUID } from "@/domain";
import type { ManageGroupDependencies } from "@/use-cases/groups/manage-group";

/** Copies a group the way a database round trip would, so tests can't share one object by accident. */
function copy(group: RegularGroup): RegularGroup {
  return new RegularGroup({
    groupId: group.groupId,
    ownerId: group.ownerId,
    name: group.name,
    invitationToken: group.invitationToken,
    invitationActive: group.invitationActive,
    status: group.status,
    memberships: group.memberships.map(
      (member) => new GroupMembership({ userId: member.userId, joinedAt: member.joinedAt }),
    ),
  });
}

/**
 * ManageGroup dependencies backed by a Map instead of Supabase.
 * Ids and tokens are predictable ("group-1", "token-1", …) so tests can refer to them.
 */
export function inMemoryGroupDependencies(options: { readonly unsettledLinkedSessions?: number } = {}) {
  const rows = new Map<UUID, RegularGroup>();
  let nextId = 1;
  let nextToken = 1;

  const deps: ManageGroupDependencies = {
    groups: {
      get: async (id) => {
        const group = rows.get(id);
        return group === undefined ? null : copy(group);
      },
      save: async (group) => {
        rows.set(group.groupId, copy(group));
      },
    },
    queries: {
      findByInvitationToken: async (token) => {
        const group = [...rows.values()].find((row) => row.invitationToken === token);
        return group === undefined ? null : copy(group);
      },
      listForMember: async (userId) =>
        [...rows.values()]
          .filter((row) => row.memberships.some((member) => member.userId === userId))
          .map(copy),
      countUnsettledLinkedSessions: async () => options.unsettledLinkedSessions ?? 0,
    },
    newId: () => `group-${nextId++}`,
    newInvitationToken: () => `token-${nextToken++}`,
    now: () => new Date("2026-10-01T08:00:00Z"),
  };

  return { deps, rows };
}