import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RegularGroup } from "@/domain";
import { supabaseDeleteAccountPorts } from "@/lib/supabase/account-admin";
import { supabaseGroupStore } from "@/lib/supabase/group-store";
import { deleteAccount } from "@/use-cases/accounts/delete-account";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

const now = new Date("2030-01-01T00:00:00Z");

function newGroup(ownerId: string): RegularGroup {
  return RegularGroup.create({
    groupId: randomUUID(), ownerId, name: "Weekend Tennis",
    invitationToken: randomUUID(), now,
  });
}

/** The same RPC used by the adapter, inside an explicitly held test transaction. */
function saveNewGroup(sql: Pick<Pool, "query">, group: RegularGroup) {
  return sql.query(
    "select save_regular_group($1,$2,$3,$4,true,'ACTIVE',null,$5::jsonb,'{}'::uuid[])",
    [group.groupId, group.ownerId, group.name, group.invitationToken,
      JSON.stringify([{ user_id: group.ownerId, joined_at: now.toISOString() }])],
  );
}

describe("UC1-06 group mutations coordinate with account deletion", () => {
  let context: SessionTestContext;
  beforeAll(() => { context = sessionTestContext(); });
  afterAll(async () => { await context?.pool.end(); });

  async function waitForLock(pid: number): Promise<void> {
    const deadline = Date.now() + 2000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      waiting = (await context.pool.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]))
        .rows[0]?.wait_event_type === "Lock";
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  }

  test("rejects creation after the owner's account becomes inactive", async () => {
    const owner = await context.identity(false);
    const group = newGroup(owner.userId);
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [owner.userId]);

    await expect(supabaseGroupStore().groups.save(group)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect((await context.pool.query("select group_id from regular_groups where group_id = $1", [group.groupId])).rows).toEqual([]);
  });

  test("rejects an already-prepared group request after account deletion finishes", async () => {
    const owner = await context.identity(false);
    // The request already authenticated and prepared the aggregate before deletion.
    const group = newGroup(owner.userId);
    const store = supabaseGroupStore();
    expect(await deleteAccount(supabaseDeleteAccountPorts(), { userId: owner.userId }))
      .toEqual({ status: "DELETED" });

    await expect(store.groups.save(group)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect((await context.pool.query("select group_id from regular_groups where owner_id = $1", [owner.userId])).rows).toEqual([]);
  });

  test("rejects a join after the joining account becomes inactive", async () => {
    const owner = await context.identity(false);
    const joiner = await context.identity(false);
    const store = supabaseGroupStore();
    const group = newGroup(owner.userId);
    await store.groups.save(group);
    group.join({ userId: joiner.userId, invitationToken: group.invitationToken, now });
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [joiner.userId]);

    await expect(store.groups.save(group)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect((await context.pool.query("select user_id from group_memberships where group_id = $1", [group.groupId])).rows)
      .toEqual([{ user_id: owner.userId }]);
  });

  test("rejects an owner mutation after the owner becomes inactive", async () => {
    const owner = await context.identity(false);
    const store = supabaseGroupStore();
    const group = newGroup(owner.userId);
    await store.groups.save(group);
    group.revokeInvitation(owner.userId);
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [owner.userId]);

    await expect(store.groups.save(group)).rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect((await context.pool.query("select invitation_active from regular_groups where group_id = $1", [group.groupId])).rows)
      .toEqual([{ invitation_active: true }]);
  });

  test("allows an active owner to remove an inactive existing member", async () => {
    const owner = await context.identity(false);
    const member = await context.identity(false);
    const store = supabaseGroupStore();
    const group = newGroup(owner.userId);
    await store.groups.save(group);
    group.join({ userId: member.userId, invitationToken: group.invitationToken, now });
    await store.groups.save(group);
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [member.userId]);
    group.removeMember({ actorId: owner.userId, userId: member.userId });

    await store.groups.save(group);
    expect((await context.pool.query("select user_id from group_memberships where group_id = $1", [group.groupId])).rows)
      .toEqual([{ user_id: owner.userId }]);
  });

  test("holds the profile lock until group creation commits so deletion's recheck sees it", async () => {
    const owner = await context.identity(false);
    const group = newGroup(owner.userId);
    const creator = await context.pool.connect();
    const deleter = await context.pool.connect();
    let deactivation: Promise<unknown> | undefined;
    try {
      await creator.query("begin");
      await saveNewGroup(creator, group);
      const pid = (await deleter.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      deactivation = deleter.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [owner.userId]);
      await waitForLock(pid);
      await creator.query("commit");
      await deactivation;
      const standing = await supabaseDeleteAccountPorts().loadStanding(owner.userId);
      expect(standing.activeOwnedGroups).toBe(1);
    } finally {
      await creator.query("rollback");
      await deactivation;
      creator.release();
      deleter.release();
    }
  });

  test("waits for an in-progress deactivation and then rejects creation", async () => {
    const owner = await context.identity(false);
    const group = newGroup(owner.userId);
    const creator = await context.pool.connect();
    const deleter = await context.pool.connect();
    let creation: Promise<unknown> | undefined;
    try {
      await deleter.query("begin");
      await deleter.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [owner.userId]);
      const pid = (await creator.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      creation = saveNewGroup(creator, group).then(() => null, (error: unknown) => error);
      await waitForLock(pid);
      await deleter.query("commit");

      expect(await creation).toMatchObject({ code: "GRP02" });
      expect((await context.pool.query("select group_id from regular_groups where group_id = $1", [group.groupId])).rows).toEqual([]);
    } finally {
      await deleter.query("rollback");
      await creation;
      creator.release();
      deleter.release();
    }
  });
});
