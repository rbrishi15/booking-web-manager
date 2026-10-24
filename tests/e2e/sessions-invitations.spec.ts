import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addCancellationParticipant, cancellationSql } from "../support/cancellation-fixtures";
import { fundInvitationWallet, invitationAdmission, invitationFixture, type InvitationIdentity } from "../support/invitation-fixtures";
import { sessionTestContext } from "../support/session-test-context";
import { openHostedSession } from "./session-overview-helpers";

async function expectLocation(page: Page, destination: string) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${url.pathname}${url.search}`;
  }).toBe(destination);
}

async function submitLogin(page: Page, identity: InvitationIdentity, destination: string) {
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expectLocation(page, destination);
}

async function login(page: Page, identity: InvitationIdentity, destination: string) {
  await page.goto(`/login?next=${encodeURIComponent(destination)}`);
  await submitLogin(page, identity, destination);
}

async function confirmJoin(page: Page) {
  const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/sessions/commit"
    && candidate.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: /^Confirm and hold / }).click();
  return response;
}

test("a host creates a private session and shares a mobile invitation that a second browser joins exactly once", async ({ page, context: hostBrowser, browser, request }, testInfo) => {
  test.setTimeout(90_000);
  const context = sessionTestContext();
  const guestBrowser = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const booker = await context.identity();
    const player = await context.identity(false);
    await fundInvitationWallet(context, player);
    const venueName = `Private UI-${randomUUID().slice(0, 8)}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, booker, "/sessions/create");
    await page.getByRole("button", { name: "Enter venue manually", exact: true }).click();
    await page.getByRole("combobox", { name: "Venue", exact: true }).fill(venueName);
    await page.getByRole("combobox", { name: "Region", exact: true }).click();
    await page.getByRole("option", { name: "West", exact: true }).click();
    await page.getByRole("button", { name: "Edit booking schedule" }).click();
    await page.getByLabel("Start date", { exact: true }).fill("2045-06-17");
    await page.getByLabel("Start time", { exact: true }).fill("18:00");
    await page.getByLabel("Duration (minutes)").fill("120");
    await page.getByRole("button", { name: "Save schedule" }).click();
    await page.getByLabel("Booking cost (SGD)").fill("40.00");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("combobox", { name: "Room Visibility" }).click();
    await page.getByRole("option", { name: "Private", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Adjust price per slot (SGD)").fill("5.00");
    const creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/sessions" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const { sessionId } = await created.json();
    await expectLocation(page, "/sessions?created=1");
    await hostBrowser.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
    await openHostedSession(page, venueName);
    const card = page.getByRole("article", { name: `Tennis at ${venueName}`, exact: true });
    const copy = card.getByRole("button", { name: "Copy invitation link", exact: true });
    await copy.focus();
    await page.keyboard.press("Enter");
    const field = card.getByLabel("Invitation link", { exact: true });
    await expect(field).toBeVisible();
    await expect(card.getByRole("status")).toHaveText("Invitation link copied.");
    const link = await field.inputValue();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    const url = new URL(link);
    const destination = `${url.pathname}${url.search}`;
    const stored = (await context.pool.query("select visibility,room_token from sessions where session_id=$1", [sessionId])).rows[0];
    expect(stored.visibility).toBe("PRIVATE");
    expect(url.searchParams.get("token")).toBe(stored.room_token);
    expect(url.pathname).toBe(`/sessions/${sessionId}/join`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("private-invitation-host-mobile.png"), fullPage: true, animations: "disabled" });
    await page.reload();
    await openHostedSession(page, venueName);
    await copy.click();
    await expect(field).toHaveValue(link);
    await expect(card.getByRole("status")).toHaveText("Invitation link copied.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);

    const ownerHeaders = { Authorization: `Bearer ${booker.token}` };
    for (const visibility of ["PUBLIC", "PRIVATE"] as const) {
      const changed = await request.patch(`/api/sessions/${sessionId}/visibility`, { headers: ownerHeaders, data: { visibility } });
      expect(changed.status()).toBe(200);
      const invitation = await request.get(`/api/sessions/${sessionId}/invitation`, { headers: ownerHeaders });
      expect(invitation.status()).toBe(200);
      expect(await invitation.json()).toEqual({ invitationPath: destination });
      if (visibility === "PUBLIC") {
        const publicListing = await request.get("/api/sessions", { params: { q: venueName } });
        expect(publicListing.status()).toBe(200);
        const publicBody = await publicListing.json();
        expect(publicBody.items.map((item: { sessionId: string }) => item.sessionId)).toEqual([sessionId]);
        expect(JSON.stringify(publicBody)).not.toContain(stored.room_token);
      }
    }

    const discovery = await request.get("/api/sessions", { params: { q: venueName } });
    expect(discovery.status()).toBe(200);
    expect(await discovery.json()).toEqual({ items: [], nextCursor: null });
    const guest = await guestBrowser.newPage();
    const preview = await guest.goto(link);
    expect(preview?.headers()["cache-control"]).toContain("no-store");
    expect(preview?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(guest.getByRole("heading", { name: venueName, exact: true })).toBeVisible();
    await expect(guest.getByRole("button", { name: /^Join .* session at / })).toHaveCount(0);
    for (const width of [390, 1280]) {
      await guest.setViewportSize({ width, height: 844 });
      await expect(guest.getByRole("link", { name: "Log in to join", exact: true })).toBeVisible();
      await expect(guest.getByRole("link", { name: "Create account", exact: true })).toBeVisible();
      expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await guest.screenshot({ path: testInfo.outputPath(`private-invitation-preview-${width}.png`), fullPage: true, animations: "disabled" });
    }
    await guest.setViewportSize({ width: 390, height: 844 });
    expect((await invitationAdmission(context, sessionId, player)).participation).toHaveLength(0);
    const loginLink = guest.getByRole("link", { name: "Log in to join", exact: true });
    expect(new URL(await loginLink.getAttribute("href") ?? "", link).searchParams.get("next")).toBe(destination);
    await loginLink.click();
    await submitLogin(guest, player, destination);
    expect((await invitationAdmission(context, sessionId, player)).participation).toHaveLength(0);
    const join = guest.getByRole("button", { name: `Join Tennis session at ${venueName}`, exact: true });
    await join.focus();
    await guest.keyboard.press("Enter");
    await expect(guest.getByRole("dialog")).toContainText("5.00");
    await guest.keyboard.press("Escape");
    await expect(join).toBeFocused();
    await guest.keyboard.press("Enter");
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guest.screenshot({ path: testInfo.outputPath("private-invitation-join-mobile.png"), fullPage: true, animations: "disabled" });
    const result = await confirmJoin(guest);
    expect(result.status()).toBe(201);
    expect(await result.json()).toMatchObject({ kind: "COMMITTED", heldCents: 500 });
    await expect(guest.getByRole("heading", { name: "You're in", exact: true })).toBeVisible();
    const admission = await invitationAdmission(context, sessionId, player);
    expect(admission.participation).toHaveLength(1);
    expect(admission.participation[0].status).toBe("COMMITTED");
    expect(admission.holds).toEqual([{ amount_cents: "500", state: "HELD" }]);
    expect(admission.locks).toEqual([{ amount_cents: "500" }]);
    const replay = await request.post("/api/sessions/commit", {
      headers: { Authorization: `Bearer ${player.token}` }, data: result.request().postDataJSON(),
    });
    expect(replay.status()).toBe(201);
    expect(await replay.json()).toEqual(await result.json());
    expect(await invitationAdmission(context, sessionId, player)).toEqual(admission);
  } finally {
    await guestBrowser.close();
    await context.pool.end();
  }
});

test("clipboard denial leaves a selectable invitation and a lost join response reuses its original request", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  const guestBrowser = await browser.newContext();
  try {
    const fixture = await invitationFixture(context);
    const player = await context.identity(false);
    await fundInvitationWallet(context, player);
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("Clipboard permission denied"); } },
    }));
    await login(page, fixture.booker, "/sessions?tab=hosting");
    await openHostedSession(page, fixture.venueName);
    const card = page.getByRole("article", { name: `Badminton at ${fixture.venueName}`, exact: true });
    await card.getByRole("button", { name: "Copy invitation link", exact: true }).click();
    const field = card.getByLabel("Invitation link", { exact: true });
    await expect(field).toHaveAttribute("readonly", "");
    await expect(card.getByRole("status")).toHaveText("Copy the invitation link below.");
    const link = await field.inputValue();
    expect(new URL(link).pathname + new URL(link).search).toBe(fixture.invitationPath);
    await field.focus();
    await page.keyboard.press("ControlOrMeta+A");
    expect(await field.evaluate((element: HTMLInputElement) => element.value.substring(element.selectionStart ?? 0, element.selectionEnd ?? 0))).toBe(link);

    const guest = await guestBrowser.newPage();
    await login(guest, player, fixture.invitationPath);
    const submitted: unknown[] = [];
    await guest.route("**/api/sessions/commit", async (route) => {
      submitted.push(route.request().postDataJSON());
      if (submitted.length === 1) {
        expect((await route.fetch()).status()).toBe(201);
        await route.abort("failed");
      } else await route.continue();
    });
    const join = guest.getByRole("button", { name: `Join Badminton session at ${fixture.venueName}`, exact: true });
    await join.click();
    await guest.getByRole("dialog").getByRole("button", { name: /^Confirm and hold / }).click();
    await expect(guest.getByRole("dialog").getByRole("alert")).toContainText("same request is reused");
    expect((await invitationAdmission(context, fixture.sessionId, player)).locks).toHaveLength(1);
    await guest.getByRole("button", { name: "Not now", exact: true }).click();
    await join.click();
    expect((await confirmJoin(guest)).status()).toBe(201);
    await expect(guest.getByRole("heading", { name: "You're in", exact: true })).toBeVisible();
    expect(submitted).toHaveLength(2);
    expect(submitted[1]).toEqual(submitted[0]);
    expect(submitted[0]).toMatchObject({ sessionId: fixture.sessionId, roomToken: fixture.roomToken });
    await guest.getByRole("button", { name: "Done", exact: true }).click();
    await join.click();
    expect((await confirmJoin(guest)).status()).toBe(409);
    await expect(guest.getByRole("dialog").getByRole("alert")).toContainText("already joined");
    const admission = await invitationAdmission(context, fixture.sessionId, player);
    expect(admission.participation).toHaveLength(1);
    expect(admission.holds).toHaveLength(1);
    expect(admission.locks).toEqual([{ amount_cents: "500" }]);
  } finally {
    await guestBrowser.close();
    await context.pool.end();
  }
});

test("a full private session remains shareable and invited players waitlist without holding money", async ({ page, request }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const fixture = await invitationFixture(context);
    for (let index = 0; index < 2; index++) {
      await addCancellationParticipant(cancellationSql(context), fixture.sessionId, await context.identity(false));
    }
    const player = await context.identity(false);
    const invitation = await request.get(`/api/sessions/${fixture.sessionId}/invitation`, { headers: { Authorization: `Bearer ${fixture.booker.token}` } });
    expect(invitation.status()).toBe(200);
    expect(await invitation.json()).toEqual({ invitationPath: fixture.invitationPath });
    await login(page, player, fixture.invitationPath);
    await page.getByRole("button", { name: `Join Badminton session at ${fixture.venueName}`, exact: true }).click();
    const joined = await confirmJoin(page);
    expect(joined.status()).toBe(201);
    expect(await joined.json()).toMatchObject({ kind: "WAITLISTED", heldCents: 0 });
    await expect(page.getByRole("heading", { name: "You're on the waitlist", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText("Nothing is held");
    const admission = await invitationAdmission(context, fixture.sessionId, player);
    expect(admission.participation).toHaveLength(1);
    expect(admission.participation[0].status).toBe("WAITLISTED");
    expect(admission.holds).toEqual([]);
    expect(admission.locks).toEqual([]);
  } finally { await context.pool.end(); }
});

test("invitation reads enforce owner access and hide private details for invalid tokens and lifecycle changes", async ({ page, request }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const fixture = await invitationFixture(context);
    const outsider = await context.identity(false);
    const endpoint = `/api/sessions/${fixture.sessionId}/invitation`;
    const ownerHeaders = { Authorization: `Bearer ${fixture.booker.token}` };
    expect((await request.get(endpoint)).status()).toBe(401);
    const foreign = await request.get(endpoint, { headers: { Authorization: `Bearer ${outsider.token}` } });
    expect(foreign.status()).toBe(403);
    expect(await foreign.text()).not.toContain(fixture.roomToken);
    const first = await request.get(endpoint, { headers: ownerHeaders });
    const second = await request.get(endpoint, { headers: ownerHeaders });
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("no-store");
    expect(await first.json()).toEqual({ invitationPath: fixture.invitationPath });
    expect(await second.json()).toEqual(await first.json());
    await page.goto(fixture.invitationPath);
    await expect(page.getByRole("heading", { name: fixture.venueName, exact: true })).toBeVisible();
    const visible = await page.getByRole("main").innerText();
    expect(visible).not.toContain(fixture.booker.email);
    expect(visible).not.toContain(fixture.booker.userId);
    expect(visible).not.toContain(fixture.booker.walletId);

    const invalidPaths = [
      `/sessions/${fixture.sessionId}/join`,
      `/sessions/${fixture.sessionId}/join?token=${randomUUID()}`,
      `/sessions/${randomUUID()}/join?token=${fixture.roomToken}`,
    ];
    for (const path of invalidPaths) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
      await expect(page.getByText("This invitation is not valid or the session is no longer accepting players.", { exact: true })).toBeVisible();
      await expect(page.getByText(fixture.venueName, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Log in to join", exact: true })).toHaveCount(0);
    }
    for (const roomToken of [undefined, randomUUID()]) {
      const rejected = await request.post("/api/sessions/commit", {
        headers: { Authorization: `Bearer ${outsider.token}` },
        data: { sessionId: fixture.sessionId, idempotencyKey: randomUUID(), ...(roomToken ? { roomToken } : {}) },
      });
      expect(rejected.status()).toBe(403);
      expect(await rejected.json()).toMatchObject({ error: { code: "INVALID_ACCESS" } });
    }
    await context.pool.query("update profiles set account_status='INACTIVE' where user_id=$1", [outsider.userId]);
    const inactiveJoin = await request.post("/api/sessions/commit", {
      headers: { Authorization: `Bearer ${outsider.token}` },
      data: { sessionId: fixture.sessionId, idempotencyKey: randomUUID(), roomToken: fixture.roomToken },
    });
    expect(inactiveJoin.status()).toBe(403);
    expect(await inactiveJoin.json()).toMatchObject({ error: { code: "INACTIVE_ACCOUNT" } });
    expect(await invitationAdmission(context, fixture.sessionId, outsider)).toEqual({ participation: [], holds: [], locks: [] });
    await context.pool.query("update profiles set account_status='ACTIVE' where user_id=$1", [outsider.userId]);
    await context.pool.query("update profiles set account_status='INACTIVE' where user_id=$1", [fixture.booker.userId]);
    const inactive = await request.get(endpoint, { headers: ownerHeaders });
    expect(inactive.status()).toBe(403);
    expect(await inactive.text()).not.toContain(fixture.roomToken);
    await context.pool.query("update profiles set account_status='ACTIVE' where user_id=$1", [fixture.booker.userId]);
    for (const lifecycle of ["cancelled", "started"] as const) {
      if (lifecycle === "cancelled") await context.pool.query("update sessions set status='CANCELLED' where session_id=$1", [fixture.sessionId]);
      else await context.pool.query("update sessions set status='OPEN',start_at='2020-01-01T10:00:00Z',end_at='2020-01-01T12:00:00Z' where session_id=$1", [fixture.sessionId]);
      const unavailable = await request.get(endpoint, { headers: ownerHeaders });
      expect(unavailable.status()).toBe(409);
      expect(await unavailable.text()).not.toContain(fixture.roomToken);
      await page.goto(fixture.invitationPath);
      await expect(page.getByRole("heading", { name: "Invitation unavailable", exact: true })).toBeVisible();
      await expect(page.getByText(fixture.venueName, { exact: true })).toHaveCount(0);
      const staleJoin = await request.post("/api/sessions/commit", {
        headers: { Authorization: `Bearer ${outsider.token}` },
        data: { sessionId: fixture.sessionId, idempotencyKey: randomUUID(), roomToken: fixture.roomToken },
      });
      expect(staleJoin.status()).toBe(409);
      expect(await staleJoin.json()).toMatchObject({ error: { code: lifecycle === "cancelled" ? "SESSION_CLOSED" : "SESSION_STARTED" } });
    }
    expect(await invitationAdmission(context, fixture.sessionId, outsider)).toEqual({ participation: [], holds: [], locks: [] });
  } finally { await context.pool.end(); }
});

test("immediate registration returns without joining and an unfunded wallet cannot hold a place", async ({ page }) => {
  test.setTimeout(60_000);
  const context = sessionTestContext();
  try {
    const fixture = await invitationFixture(context);
    const email = `invited-${randomUUID()}@example.com`;
    const handle = `invited_${randomUUID().slice(0, 8)}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(fixture.invitationPath);
    const register = page.getByRole("link", { name: "Create account", exact: true });
    expect(new URL(await register.getAttribute("href") ?? "", page.url()).searchParams.get("next")).toBe(fixture.invitationPath);
    await register.click();
    await page.getByLabel("Region", { exact: true }).selectOption("West");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(`Invite-${randomUUID()}!`);
    await page.getByRole("button", { name: "Sign Up", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Invited player");
    await page.getByLabel("Preferred sport", { exact: true }).selectOption("Badminton");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("User ID", { exact: true }).fill(handle);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expectLocation(page, fixture.invitationPath);
    await expect(page.getByRole("heading", { name: fixture.venueName, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `Join Badminton session at ${fixture.venueName}`, exact: true })).toBeVisible();
    const accounts = await context.pool.query(
      `select u.id,b.available_cents,b.entry_count from auth.users u join wallets w on w.user_id=u.id
       join wallet_balances b on b.wallet_id=w.wallet_id where u.email=$1`, [email],
    );
    expect(accounts.rows).toHaveLength(1);
    expect(accounts.rows[0]).toMatchObject({ available_cents: "0", entry_count: "0" });
    expect((await context.pool.query("select handle from profiles where user_id=$1", [accounts.rows[0].id])).rows).toEqual([{ handle }]);
    expect((await context.pool.query("select count(*)::int as count from participations where session_id=$1 and user_id=$2", [fixture.sessionId, accounts.rows[0].id])).rows).toEqual([{ count: 0 }]);
    await page.getByRole("button", { name: `Join Badminton session at ${fixture.venueName}`, exact: true }).click();
    const unfunded = await confirmJoin(page);
    expect(unfunded.status()).toBe(409);
    expect(await unfunded.json()).toMatchObject({ error: { code: "INSUFFICIENT_FUNDS" } });
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("doesn't have enough available balance");
    await expect(page.getByRole("dialog").getByRole("link", { name: "Go to wallet", exact: true })).toHaveAttribute("href", "/wallet");
    expect((await context.pool.query("select count(*)::int as count from participations where session_id=$1 and user_id=$2", [fixture.sessionId, accounts.rows[0].id])).rows).toEqual([{ count: 0 }]);
    expect((await context.pool.query("select available_cents,entry_count from wallet_balances b join wallets w using(wallet_id) where w.user_id=$1", [accounts.rows[0].id])).rows).toEqual([{ available_cents: "0", entry_count: "0" }]);
  } finally { await context.pool.end(); }
});
