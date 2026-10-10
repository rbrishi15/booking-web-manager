import { combineChunks, createChunks, createServerClient } from "@supabase/ssr";
import { expect, test, type APIResponse } from "@playwright/test";
import { sessionTestContext, sessionTestEnvironment } from "../support/session-test-context";

// UC1-05: the wallet API identifies the browser by its real Supabase login cookies, with no
// bearer token. Runs against the disposable local stack (npm run test:e2e:integration).

type Jar = Map<string, string>;
type StoredSession = { access_token: string; refresh_token: string; expires_at: number } & Record<string, unknown>;

const { supabaseUrl, anonKey } = sessionTestEnvironment();
const cookieKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

/** Signs in with @supabase/ssr, exactly as the login page does, and returns the cookies it sets. */
async function loginCookies(email: string, password: string): Promise<Jar> {
  const jar: Jar = new Map();
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => { for (const { name, value } of cookies) if (value) jar.set(name, value); else jar.delete(name); },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return jar;
}

async function readSession(jar: Jar): Promise<StoredSession> {
  const value = await combineChunks(cookieKey, (name) => jar.get(name));
  if (!value?.startsWith("base64-")) throw new Error("No login cookie");
  return JSON.parse(Buffer.from(value.slice("base64-".length), "base64url").toString()) as StoredSession;
}

function withSession(jar: Jar, session: StoredSession): Jar {
  const next: Jar = new Map([...jar].filter(([name]) => !name.startsWith(cookieKey)));
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  for (const chunk of createChunks(cookieKey, value)) next.set(chunk.name, chunk.value);
  return next;
}

/** The same login, with an access token that has already expired, so the server must refresh it. */
async function expired(jar: Jar): Promise<Jar> {
  return withSession(jar, { ...await readSession(jar), expires_at: Math.floor(Date.now() / 1000) - 60 });
}

const cookieHeader = (jar: Jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

/** Applies a response's Set-Cookie headers to the jar, as the browser would. */
function receive(jar: Jar, response: APIResponse): Jar {
  const next: Jar = new Map(jar);
  for (const header of response.headersArray()) {
    if (header.name.toLowerCase() !== "set-cookie") continue;
    const [pair = ""] = header.value.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value) next.set(name, value); else next.delete(name);
  }
  return next;
}

test("UC1-05 the wallet page reads the wallet with the browser's login cookies, not a bearer token", async ({ page }) => {
  const identity = await sessionTestContext().identity();
  await page.goto(`/login?next=${encodeURIComponent("/wallet")}`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Password", { exact: true }).fill(identity.password);
  const walletRead = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/wallet");
  await page.getByRole("button", { name: "Log in", exact: true }).click();

  const request = await walletRead;
  expect(await request.headerValue("authorization")).toBeNull();
  expect((await request.response())?.status()).toBe(200);
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
});

test("UC1-05 the wallet API accepts a real login cookie and rejects missing, invalid and signed-out ones", async ({ request }) => {
  const identity = await sessionTestContext().identity();
  const jar = await loginCookies(identity.email, identity.password);

  const signedIn = await request.get("/api/wallet", { headers: { cookie: cookieHeader(jar) } });
  expect(signedIn.status()).toBe(200);
  expect(await signedIn.json()).toMatchObject({ userId: identity.userId, walletId: identity.walletId });

  expect((await request.get("/api/wallet")).status()).toBe(401);

  const forged = withSession(jar, { ...await readSession(jar), access_token: "not-a-real-token", refresh_token: "not-a-real-refresh-token" });
  expect((await request.get("/api/wallet", { headers: { cookie: cookieHeader(forged) } })).status()).toBe(401);

  // Cookies never authorize a change: another site could make the browser send them (CSRF).
  const topUp = await request.post("/api/wallet/top-up", {
    headers: { cookie: cookieHeader(jar) },
    data: { amountCents: 1000, idempotencyKey: "cookie-only-top-up" },
  });
  expect(topUp.status()).toBe(401);

  // After signing out everywhere, the old cookie's refresh token no longer works.
  const stale = await expired(jar);
  const revoked = createServerClient(supabaseUrl, anonKey, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: () => undefined } });
  await revoked.auth.signOut({ scope: "global" });
  expect((await request.get("/api/wallet", { headers: { cookie: cookieHeader(stale) } })).status()).toBe(401);
});

test("UC1-05 two simultaneous wallet reads with an expired access token both refresh and keep the user signed in", async ({ request }) => {
  const identity = await sessionTestContext().identity();
  const jar = await expired(await loginCookies(identity.email, identity.password));

  // The page loads the summary and the first transactions page at the same time.
  const [summary, transactions] = await Promise.all([
    request.get("/api/wallet", { headers: { cookie: cookieHeader(jar) } }),
    request.get("/api/wallet/transactions?limit=20", { headers: { cookie: cookieHeader(jar) } }),
  ]);
  expect(summary.status()).toBe(200);
  expect(transactions.status()).toBe(200);

  // Each reply returns a refreshed login; whichever the browser keeps still works afterwards.
  for (const reply of [summary, transactions]) {
    const refreshed = receive(jar, reply);
    expect((await readSession(refreshed)).refresh_token).not.toBe((await readSession(jar)).refresh_token);
    expect((await request.get("/api/wallet", { headers: { cookie: cookieHeader(refreshed) } })).status()).toBe(200);
  }
});
