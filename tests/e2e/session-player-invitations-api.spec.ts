import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { invitationFixture } from "../support/invitation-fixtures";
import { sessionTestContext, type SessionTestContext } from "../support/session-test-context";

async function player(context: SessionTestContext) {
  const identity = await context.identity(false);
  const handle = `player_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await context.pool.query("update profiles set handle=$2,display_name='Invited Alice' where user_id=$1", [identity.userId, handle]);
  return { ...identity, handle };
}

test("invitation HTTP API enforces ownership, normalizes exact IDs, and safely replays invitations", async ({ request }) => {
  const context = sessionTestContext();
  try {
    const f = await invitationFixture(context);
    const recipient = await player(context);
    const url = `/api/sessions/${f.sessionId}/invitations`;
    const headers = { Authorization: `Bearer ${f.booker.token}` };
    expect((await request.get(url)).status()).toBe(401);
    expect((await request.post(url, { data: { source: "direct", handles: [recipient.handle] } })).status()).toBe(401);
    const forbidden = await request.get(url, { headers: { Authorization: `Bearer ${recipient.token}` } });
    expect(forbidden.status()).toBe(403);
    expect(await forbidden.text()).not.toContain("Invited Alice");
    expect((await request.post(url, { headers, data: { source: "direct", handles: [] } })).status()).toBe(400);
    expect((await request.post(url, { headers, data: { source: "direct", handles: [recipient.handle, `@${recipient.handle.toUpperCase()}`] } })).status()).toBe(400);
    const data = { source: "direct", handles: [`@${recipient.handle.toUpperCase()}`] };
    const first = await request.post(url, { headers, data });
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("no-store");
    expect(await first.json()).toEqual({ invited: 1, alreadyInvited: 0, alreadyParticipating: 0 });
    expect(await (await request.post(url, { headers, data })).json()).toEqual({ invited: 0, alreadyInvited: 1, alreadyParticipating: 0 });
    const options = await request.get(url, { headers });
    expect(options.status()).toBe(200);
    expect(await options.json()).toMatchObject({ groups: [], invitations: [{ inviteeId: recipient.userId, handle: recipient.handle, displayName: "Invited Alice", status: "PENDING", invitedAt: expect.any(String) }] });
    const effects = (await context.pool.query(`select
      (select count(*)::int from session_invitations where session_id=$1) as invitations,
      (select count(*)::int from notification_inbox where session_id=$1 and kind='SESSION_INVITATION') as notices,
      (select count(*)::int from participations where session_id=$1) as participants,
      (select count(*)::int from ledger_entries where session_id=$1) as money`, [f.sessionId])).rows[0];
    expect(effects).toEqual({ invitations: 1, notices: 1, participants: 0, money: 0 });
    await context.pool.query("update sessions set status='CANCELLED' where session_id=$1", [f.sessionId]);
    expect((await request.post(url, { headers, data })).status()).toBe(409);
    expect((await request.get(url, { headers })).status()).toBe(200);
  } finally { await context.pool.end(); }
});

test("group invitation API rechecks current membership after loading options", async ({ request }) => {
  const context = sessionTestContext();
  try {
    const f = await invitationFixture(context);
    const first = await player(context);
    const second = await player(context);
    const groupId = randomUUID();
    await context.pool.query("insert into regular_groups(group_id,owner_id,name,invitation_token,invitation_active,status) values($1,$2,'API group',$3,true,'ACTIVE')", [groupId, f.booker.userId, randomUUID()]);
    await context.pool.query("insert into group_memberships(group_id,user_id,joined_at) values($1,$2,now()),($1,$3,now()),($1,$4,now())", [groupId, f.booker.userId, first.userId, second.userId]);
    const url = `/api/sessions/${f.sessionId}/invitations`;
    const headers = { Authorization: `Bearer ${f.booker.token}` };
    expect(await (await request.get(url, { headers })).json()).toMatchObject({ groups: [{ groupId, name: "API group", memberCount: 3, members: expect.arrayContaining([{ userId: first.userId, handle: first.handle, displayName: "Invited Alice" }]) }] });
    const sent = await request.post(url, { headers, data: { source: "group", groupId, userIds: [first.userId] } });
    expect(sent.status()).toBe(200);
    expect(await sent.json()).toMatchObject({ invited: 1 });
    await context.pool.query("delete from group_memberships where group_id=$1 and user_id=$2", [groupId, second.userId]);
    const stale = await request.post(url, { headers, data: { source: "group", groupId, userIds: [second.userId] } });
    expect(stale.status()).toBe(403);
    expect((await context.pool.query("select count(*)::int as count from session_invitations where session_id=$1", [f.sessionId])).rows[0].count).toBe(1);
  } finally { await context.pool.end(); }
});

test("participant UI sends through React Query HTTP and cookie API rejects an invalid bearer", async ({ page }) => {
  const context = sessionTestContext();
  try {
    const f = await invitationFixture(context);
    const recipient = await player(context);
    const destination = `/sessions/${f.sessionId}/participants`;
    await page.goto(`/login?next=${encodeURIComponent(destination)}`);
    await page.getByLabel("Email", { exact: true }).fill(f.booker.email);
    await page.getByLabel("Password", { exact: true }).fill(f.booker.password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
    await expect(page.getByRole("button", { name: "Import from group" })).toBeEnabled();
    const url = `/api/sessions/${f.sessionId}/invitations`;
    expect((await page.request.get(url)).status()).toBe(200);
    expect((await page.request.post(url, { data: { source: "direct", handles: [recipient.handle] } })).status()).toBe(401);
    expect((await page.request.get(url, { headers: { Authorization: "Bearer rejected" } })).status()).toBe(401);
    await page.getByRole("button", { name: "Invite player", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("User ID", { exact: true }).fill(recipient.handle);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByRole("button", { name: `Remove @${recipient.handle}` })).toBeVisible();
    const sent = page.waitForResponse((response) => new URL(response.url()).pathname === url && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Invite players", exact: true }).click();
    expect((await sent).status()).toBe(200);
    await expect(page.getByRole("tab", { name: "Invitations (1)" })).toBeVisible();
    await page.getByRole("tab", { name: "Invitations (1)" }).click();
    await expect(page.getByRole("list", { name: "Invitations", exact: true })).toContainText("Invited Alice");
  } finally { await context.pool.end(); }
});
