import type { Pool } from "pg";
import { z } from "zod";
import type { UUID } from "@/domain";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { isRetryable } from "@/lib/money/errors";
import type { Clock } from "@/use-cases/shared/contracts";
import type {
  InvitablePlayer, SessionInvitationGroup, SessionInvitationRepositories, SessionInvitationTransaction, SessionInvite,
} from "@/use-cases/sessions/ManageSessionInvitations";
import { PostgresNotificationWriter } from "@/lib/notifications/postgres-notification-writer";
import type { PostCommitNotificationPublisher } from "@/lib/notifications/postcommit-publisher";
import { PostgresSessionManagementRepository } from "./postgres-session-management-repository";
import { PostgresUserReader } from "./postgres-user-reader";
import { text, date } from "./postgres-row-values";
import type { SqlExecutor } from "@/lib/money/sql";

function player(row: import("@/lib/money/sql").SqlRow): InvitablePlayer {
  return {
    userId: text(row.user_id),
    handle: row.handle === null ? null : text(row.handle),
    displayName: text(row.display_name),
  };
}

class InvitationRecipients {
  constructor(private readonly sql: SqlExecutor) {}

  async listGroups(hostId: UUID): Promise<readonly SessionInvitationGroup[]> {
    const rows = await this.sql.query(
      `select g.group_id,g.name,count(*) over(partition by g.group_id)::integer as member_count,
         p.user_id,p.handle,p.account_status,
         coalesce(nullif(trim(p.display_name),''),'Unnamed player') as display_name
       from regular_groups g
       join group_memberships host on host.group_id=g.group_id and host.user_id=$1
       join group_memberships m on m.group_id=g.group_id
       join profiles p on p.user_id=m.user_id
       where g.status='ACTIVE'
       order by lower(g.name),g.group_id,m.joined_at,m.user_id`, [hostId]);
    const groups = new Map<string, { groupId: string; name: string; memberCount: number; members: InvitablePlayer[] }>();
    for (const row of rows) {
      const groupId = text(row.group_id);
      let group = groups.get(groupId);
      if (!group) {
        group = { groupId, name: text(row.name), memberCount: z.number().int().positive().parse(row.member_count), members: [] };
        groups.set(groupId, group);
      }
      if (row.account_status === "ACTIVE" && row.user_id !== hostId) group.members.push(player(row));
    }
    return [...groups.values()];
  }

  async byHandles(handles: readonly string[]): Promise<readonly InvitablePlayer[]> {
    const rows = await this.sql.query(
      `select user_id,handle,coalesce(nullif(trim(display_name),''),'Unnamed player') as display_name
       from profiles where handle=any($1::text[]) and account_status='ACTIVE'
       order by handle`, [handles]);
    return rows.map(player);
  }

  async fromGroup(hostId: UUID, groupId: UUID, selectedIds: readonly UUID[]): Promise<readonly InvitablePlayer[]> {
    const rows = await this.sql.query(
      `select p.user_id,p.handle,coalesce(nullif(trim(p.display_name),''),'Unnamed player') as display_name
       from regular_groups g join group_memberships owner_membership
         on owner_membership.group_id=g.group_id and owner_membership.user_id=$1
       join group_memberships m on m.group_id=g.group_id
       join profiles p on p.user_id=m.user_id and p.account_status='ACTIVE'
       where g.group_id=$2 and g.status='ACTIVE' and m.user_id=any($3::uuid[])
       order by m.user_id`, [hostId, groupId, selectedIds]);
    return rows.map(player);
  }
}

class Invitations {
  constructor(private readonly sql: SqlExecutor) {}

  async add(sessionId: UUID, invitedBy: UUID, players: readonly InvitablePlayer[], groupId?: UUID): Promise<readonly UUID[]> {
    if (players.length === 0) return [];
    const rows = await this.sql.query(
      `insert into session_invitations(session_id,invitee_id,invited_by,source_group_id,status,invited_at)
       select $1::uuid,p.user_id,$2::uuid,$4::uuid,'PENDING',statement_timestamp()
       from profiles p where p.user_id=any($3::uuid[]) and p.account_status='ACTIVE'
       and not exists(select 1 from participations part where part.session_id=$1 and part.user_id=p.user_id)
       on conflict (session_id,invitee_id) do nothing
       returning invitee_id`,
      [sessionId, invitedBy, players.map((p) => p.userId), groupId ?? null]);
    return rows.map((row) => text(row.invitee_id));
  }

  async list(sessionId: UUID): Promise<readonly SessionInvite[]> {
    const rows = await this.sql.query(
      `select i.invitee_id,i.status,i.invited_at,p.handle,
       case when p.account_status='ACTIVE' then coalesce(nullif(trim(p.display_name),''),'Unnamed player')
       else 'Deleted user' end as display_name
       from session_invitations i join profiles p on p.user_id=i.invitee_id
       where i.session_id=$1 order by i.invited_at desc,i.invitee_id`, [sessionId]);
    return rows.map((row) => ({
      inviteeId: text(row.invitee_id),
      displayName: text(row.display_name),
      handle: row.handle === null ? null : text(row.handle),
      status: z.enum(["PENDING", "ACCEPTED", "DECLINED"]).parse(row.status),
      invitedAt: date(row.invited_at),
    }));
  }
}

/** Serializable owner checks, invite writes and inbox notifications share one SQL transaction. */
export class PostgresSessionInvitationTransaction implements SessionInvitationTransaction {
  constructor(
    private readonly getPool: () => Pool,
    private readonly clock: Clock,
    private readonly publish?: PostCommitNotificationPublisher,
  ) {}

  async run<T>(work: (repos: SessionInvitationRepositories) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const recipients = new Set<string>();
      try {
        const result = await new PostgresTransactor(this.getPool(), "serializable").transaction(async (sql) => work({
          users: new PostgresUserReader(sql, this.clock),
          sessions: new PostgresSessionManagementRepository(sql),
          recipients: new InvitationRecipients(sql),
          invitations: new Invitations(sql),
          notifications: new PostgresNotificationWriter(sql, "SESSION_INVITATION", recipients),
        }));
        if (recipients.size && this.publish) {
          try { this.publish([...recipients]); } catch { /* Inbox commit is authoritative. */ }
        }
        return result;
      } catch (error) {
        if (isRetryable(error) && attempt < 3) continue;
        throw error;
      }
    }
  }
}
