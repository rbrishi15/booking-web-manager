import { randomBytes, randomUUID } from "node:crypto";
import { DomainError, GroupMembership, RegularGroup, type GroupStatus, type UUID } from "@/domain";
import { ManageGroup, type GroupQueries } from "@/use-cases/groups/manage-group";
import type { Repository } from "@/use-cases/shared/contracts";
import { createAdminClient } from "./admin";

// Tables come from Neoh's migration 0005 (regular_groups, group_memberships); writes go
// through save_regular_group from migration 0006. 0005 blocks browser access to them, so this
// file reads and writes on the server with the service role client. SERVER ONLY.
const GROUP_COLUMNS =
  "group_id, owner_id, name, invitation_token, invitation_active, status, version, group_memberships(user_id, joined_at)";

interface GroupRow {
  group_id: string;
  owner_id: string;
  name: string;
  invitation_token: string;
  invitation_active: boolean;
  status: string;
  version: number;
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

/** What a group looked like when it was read, used to work out what this request changed. */
interface LoadedGroup {
  /** regular_groups.version when it was read; the save must still find this version. */
  readonly version: number;
  readonly members: ReadonlySet<UUID>;
}

/** Postgres "serialization failure": save_regular_group found a newer version than this request read. */
const GROUP_CHANGED = "40001";
/** save_regular_group refused to archive: a linked session is still unsettled (0006's own SQLSTATE). */
const UNSETTLED_LINKED_SESSIONS = "GRP01";

/** Someone else changed the group after this request read it; saving would overwrite their change. */
export class GroupChangedError extends Error {
  constructor() {
    super("The group was changed by someone else. Refresh the page and try again.");
    this.name = "GroupChangedError";
  }
}

/**
 * Supabase-backed storage for RegularGroup (the Repository contract) plus the extra group lookups.
 * save() sends the group and the members this request added or removed to save_regular_group,
 * which writes them in one transaction and only if nobody saved the group since this request read
 * it. So a new group always has its owner as a member, and a join can never slip past the owner
 * turning the link off or archiving the group.
 */
export function supabaseGroupStore(): { groups: Repository<RegularGroup>; queries: GroupQueries } {
  const admin = createAdminClient();
  const loaded = new WeakMap<RegularGroup, LoadedGroup>();

  function remember(group: RegularGroup, version: number): RegularGroup {
    loaded.set(group, { version, members: new Set(group.memberships.map((member) => member.userId)) });
    return group;
  }

  async function selectOne(column: "group_id" | "invitation_token", value: string): Promise<RegularGroup | null> {
    const { data, error } = await admin.from("regular_groups").select(GROUP_COLUMNS).eq(column, value).maybeSingle();
    if (error !== null) throw error;
    if (data === null) return null;
    const row = data as GroupRow;
    return remember(toGroup(row), row.version);
  }

  const groups: Repository<RegularGroup> = {
    get: (groupId) => selectOne("group_id", groupId),

    async save(group) {
      const previous = loaded.get(group);
      const before = previous?.members ?? new Set<UUID>();
      const now = new Set(group.memberships.map((member) => member.userId));
      const added = group.memberships.filter((member) => !before.has(member.userId));
      const removed = [...before].filter((userId) => !now.has(userId));

      const { data: version, error } = await admin.rpc("save_regular_group", {
        p_group_id: group.groupId,
        p_owner_id: group.ownerId,
        p_name: group.name,
        p_invitation_token: group.invitationToken,
        p_invitation_active: group.invitationActive,
        p_status: group.status,
        // null = a new group, inserted together with its owner's membership.
        p_expected_version: previous?.version ?? null,
        p_added_members: added.map((member) => ({ user_id: member.userId, joined_at: member.joinedAt.toISOString() })),
        p_removed_members: removed,
      });
      if (error !== null) {
        if (error.code === GROUP_CHANGED) throw new GroupChangedError();
        if (error.code === UNSETTLED_LINKED_SESSIONS) {
          throw new DomainError("ACTIVE_OBLIGATIONS", "A group with unsettled linked sessions cannot be archived");
        }
        throw error;
      }
      remember(group, version as number);
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
      return (data as GroupRow[]).map((row) => remember(toGroup(row), row.version));
    },

    // Sessions created with this group invited (sessions.invited_group_id, Neoh's 0005) that are not
    // settled or cancelled yet. Any error stops the archive (fail closed).
    async countUnsettledLinkedSessions(groupId) {
      // A database function (0005), so it also answers 0 before the sessions table exists.
      const { data, error } = await admin.rpc("count_unsettled_linked_sessions", { p_group_id: groupId });
      if (error !== null) throw error;
      return data ?? 0;
    },
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