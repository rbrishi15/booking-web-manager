import { randomBytes, randomUUID } from "node:crypto";
import { GroupMembership, RegularGroup, type GroupStatus, type UUID } from "@/domain";
import { ManageGroup, type GroupQueries } from "@/use-cases/groups/manage-group";
import type { Repository } from "@/use-cases/shared/contracts";
import { createAdminClient } from "./admin";

// Tables come from Neoh's migration 0005 (regular_groups, group_memberships).
// 0005 blocks browser access to them, so this file reads and writes on the server
// with the service role client. SERVER ONLY.
const GROUP_COLUMNS =
  "group_id, owner_id, name, invitation_token, invitation_active, status, group_memberships(user_id, joined_at)";

interface GroupRow {
  group_id: string;
  owner_id: string;
  name: string;
  invitation_token: string;
  invitation_active: boolean;
  status: string;
  group_memberships: { user_id: string; joined_at: string }[];
}

/** Rebuilds the domain object from a database row, members in the order they joined. */
function toGroup(row: GroupRow): RegularGroup {
  const members = [...row.group_memberships].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
  return new RegularGroup({
    groupId: row.group_id,
    ownerId: row.owner_id,
    name: row.name,
    invitationToken: row.invitation_token,
    invitationActive: row.invitation_active,
    status: row.status as GroupStatus,
    memberships: members.map(
      (member) => new GroupMembership({ userId: member.user_id, joinedAt: new Date(member.joined_at) }),
    ),
  });
}

/**
 * Supabase-backed storage for RegularGroup (the Repository contract) plus the extra group lookups.
 * save() only adds the members this request added and removes the ones it removed, so two
 * people joining at the same moment can't wipe out each other's membership.
 */
export function supabaseGroupStore(): { groups: Repository<RegularGroup>; queries: GroupQueries } {
  const admin = createAdminClient();
  /** The member ids each loaded group had when it was read, used to work out what changed. */
  const loadedMembers = new WeakMap<RegularGroup, ReadonlySet<UUID>>();

  function remember(group: RegularGroup): RegularGroup {
    loadedMembers.set(group, new Set(group.memberships.map((member) => member.userId)));
    return group;
  }

  async function selectOne(column: "group_id" | "invitation_token", value: string): Promise<RegularGroup | null> {
    const { data, error } = await admin.from("regular_groups").select(GROUP_COLUMNS).eq(column, value).maybeSingle();
    if (error !== null) throw error;
    return data === null ? null : remember(toGroup(data as GroupRow));
  }

  const groups: Repository<RegularGroup> = {
    get: (groupId) => selectOne("group_id", groupId),

    async save(group) {
      // 1. The group row itself (insert the first time, update after that).
      const { error: groupError } = await admin.from("regular_groups").upsert({
        group_id: group.groupId,
        owner_id: group.ownerId,
        name: group.name,
        invitation_token: group.invitationToken,
        invitation_active: group.invitationActive,
        status: group.status,
      });
      if (groupError !== null) throw groupError;

      // 2. Members: add the new ones, remove the removed ones, leave everyone else alone.
      const before = loadedMembers.get(group) ?? new Set<UUID>();
      const now = new Set(group.memberships.map((member) => member.userId));
      const added = group.memberships.filter((member) => !before.has(member.userId));
      const removed = [...before].filter((userId) => !now.has(userId));

      if (added.length > 0) {
        const { error } = await admin.from("group_memberships").upsert(
          added.map((member) => ({
            group_id: group.groupId,
            user_id: member.userId,
            joined_at: member.joinedAt.toISOString(),
          })),
          { onConflict: "group_id,user_id", ignoreDuplicates: true },
        );
        if (error !== null) throw error;
      }
      if (removed.length > 0) {
        const { error } = await admin
          .from("group_memberships")
          .delete()
          .eq("group_id", group.groupId)
          .in("user_id", removed);
        if (error !== null) throw error;
      }
      remember(group);
    },
  };

  const queries: GroupQueries = {
    findByInvitationToken: (token) => selectOne("invitation_token", token),

    async listForMember(userId) {
      const { data: memberships, error } = await admin
        .from("group_memberships")
        .select("group_id")
        .eq("user_id", userId);
      if (error !== null) throw error;
      if (memberships.length === 0) return [];

      const { data, error: groupsError } = await admin
        .from("regular_groups")
        .select(GROUP_COLUMNS)
        .in(
          "group_id",
          memberships.map((row) => row.group_id),
        )
        .order("name");
      if (groupsError !== null) throw groupsError;
      return (data as GroupRow[]).map((row) => remember(toGroup(row)));
    },

    // Sessions are Neoh's (0005). Until the sessions workflow is on main, no session is linked to a group.
    countUnsettledLinkedSessions: async () => 0,
  };

  return { groups, queries };
}

/** A ready-to-use ManageGroup for server actions and pages. */
export function createManageGroup(): ManageGroup {
  const { groups, queries } = supabaseGroupStore();
  return new ManageGroup({
    groups,
    queries,
    newId: () => randomUUID(),
    // 32 random bytes → a 43-character link code that nobody can guess.
    newInvitationToken: () => randomBytes(32).toString("base64url"),
    now: () => new Date(),
  });
}