import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresSessionInvitationTransaction } from "@/lib/sessions/postgres-session-invitation-transaction";
import { ManageSessionInvitations, type SessionInvitationTransaction } from "@/use-cases/sessions/ManageSessionInvitations";
import { addCancellationParticipant, cancellationSql } from "../support/cancellation-fixtures";
import { invitationFixture } from "../support/invitation-fixtures";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

const clock = { now: () => new Date("2040-01-01T00:00:00Z") };

describe("booker session invitations persistence", () => {
  let context: SessionTestContext;
  beforeAll(() => { context = sessionTestContext(); });
  afterAll(async () => { await context?.pool.end(); });
  const transaction = () => new PostgresSessionInvitationTransaction(() => context.pool, clock);
  const invitations = (tx: SessionInvitationTransaction = transaction()) => new ManageSessionInvitations({ transaction: tx, clock });
  async function recipient() {
    const identity = await context.identity(false);
    const handle = `player_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await context.pool.query("update profiles set handle=$2 where user_id=$1", [identity.userId, handle]);
    return { ...identity, handle };
  }
  async function counts(sessionId: string) {
    return (await context.pool.query(
      `select (select count(*)::int from session_invitations where session_id=$1) as invites,
       (select count(*)::int from notification_inbox where session_id=$1 and kind='SESSION_INVITATION') as notices,
       (select count(*)::int from participations where session_id=$1) as participants,
       (select count(*)::int from ledger_entries where session_id=$1) as ledger`, [sessionId])).rows[0];
  }

  test("concurrent and repeated sends persist one invitation and notification without enrollment or charges", async () => {
    const f = await invitationFixture(context);
    const player = await recipient();
    const send = () => invitations().inviteByHandles(f.booker.userId, f.sessionId, [player.handle]);
    const sent = await Promise.all([send(), send()]);
    expect(sent.map((result) => result.invited).sort()).toEqual([0, 1]);
    expect(await send()).toEqual({ invited: 0, alreadyInvited: 1, alreadyParticipating: 0 });
    expect(await counts(f.sessionId)).toEqual({ invites: 1, notices: 1, participants: 0, ledger: 0 });
    const notice = (await context.pool.query("select destination from notification_inbox where session_id=$1", [f.sessionId])).rows[0];
    expect(notice.destination).toBe(`/sessions/${f.sessionId}/join?token=${f.roomToken}`);
  });

  test("notification failure rolls back the invitation and permits a clean retry", async () => {
    const f = await invitationFixture(context);
    const player = await recipient();
    const failure = new Error("Notification persistence unavailable");
    const real = transaction();
    const failing: SessionInvitationTransaction = { run: (work) => real.run((repos) => work({
      ...repos, notifications: { append: async () => { throw failure; } },
    })) };
    await expect(invitations(failing).inviteByHandles(f.booker.userId, f.sessionId, [player.handle])).rejects.toBe(failure);
    expect(await counts(f.sessionId)).toEqual({ invites: 0, notices: 0, participants: 0, ledger: 0 });
    expect(await invitations().inviteByHandles(f.booker.userId, f.sessionId, [player.handle])).toMatchObject({ invited: 1 });
  });

  test("crossing the start cutoff during the last write rolls back invitations and inbox rows", async () => {
    const f = await invitationFixture(context);
    const player = await recipient();
    let current = new Date("2045-06-17T09:59:59Z");
    const deadlineClock = { now: () => current };
    const published: string[][] = [];
    const real = new PostgresSessionInvitationTransaction(() => context.pool, deadlineClock, (recipients) => { published.push([...recipients]); });
    const delayed: SessionInvitationTransaction = { run: (work) => real.run((repos) => work({
      ...repos, notifications: { append: async (notices) => {
        await repos.notifications.append(notices);
        current = new Date("2045-06-17T10:00:00Z");
      } },
    })) };
    const useCase = new ManageSessionInvitations({ transaction: delayed, clock: deadlineClock });
    await expect(useCase.inviteByHandles(f.booker.userId, f.sessionId, [player.handle])).rejects.toMatchObject({ code: "SESSION_STARTED" });
    expect(await counts(f.sessionId)).toEqual({ invites: 0, notices: 0, participants: 0, ledger: 0 });
    expect(published).toEqual([]);
  });

  test("group reads and sends use current active membership and reject arbitrary or stale member IDs", async () => {
    const f = await invitationFixture(context);
    const player = await recipient();
    const stranger = await recipient();
    const groupId = randomUUID();
    await context.pool.query(
      "insert into regular_groups(group_id,owner_id,name,invitation_token,invitation_active,status) values($1,$2,'Tennis Buddies',$3,true,'ACTIVE')",
      [groupId, f.booker.userId, randomUUID()]);
    await context.pool.query("insert into group_memberships(group_id,user_id,joined_at) values($1,$2,now()),($1,$3,now())", [groupId, f.booker.userId, player.userId]);
    expect(await invitations().optionsForBooker(f.booker.userId, f.sessionId)).toMatchObject({
      groups: [{ groupId, name: "Tennis Buddies", memberCount: 2, members: [{ userId: player.userId, handle: player.handle }] }], invitations: [],
    });
    await expect(invitations().inviteFromGroup(f.booker.userId, f.sessionId, groupId, [stranger.userId])).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await context.pool.query("delete from group_memberships where group_id=$1 and user_id=$2", [groupId, player.userId]);
    await expect(invitations().inviteFromGroup(f.booker.userId, f.sessionId, groupId, [player.userId])).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await counts(f.sessionId)).toEqual({ invites: 0, notices: 0, participants: 0, ledger: 0 });
  });

  test("joining accepts the pending invitation atomically and makes its push irrelevant", async () => {
    const f = await invitationFixture(context);
    const player = await recipient();
    await invitations().inviteByHandles(f.booker.userId, f.sessionId, [player.handle]);
    const relevant = async () => (await context.pool.query("select public.notification_push_relevant('SESSION_INVITATION',$1,$2,null) as relevant", [player.userId, f.sessionId])).rows[0].relevant;
    expect(await relevant()).toBe(true);
    await addCancellationParticipant(cancellationSql(context), f.sessionId, player);
    expect((await invitations().listForBooker(f.booker.userId, f.sessionId))[0]).toMatchObject({ inviteeId: player.userId, status: "ACCEPTED" });
    expect(await relevant()).toBe(false);
  });
});
