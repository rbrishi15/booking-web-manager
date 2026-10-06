import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { PostgresTransactor } from "@/lib/database/postgres-transactor";
import { PostgresUserReader } from "@/lib/sessions/postgres-user-reader";
import { createUpdateProfile } from "@/use-case-config/profiles";
import { sessionTestContext, sessionTestEnvironment, type SessionTestContext } from "../support/session-test-context";

describe("UC1-03 profile persistence policy", () => {
  let context: SessionTestContext;
  beforeAll(() => { context = sessionTestContext(); });
  afterAll(async () => { await context?.pool.end(); });

  function authenticated(token: string) {
    const { supabaseUrl, anonKey } = sessionTestEnvironment();
    return createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async function profile(userId: string) {
    const result = await context.pool.query(
      "select display_name, preferred_sports, preferred_regions, account_status from profiles where user_id = $1", [userId],
    );
    return result.rows[0];
  }

  test("saves an active user's profile through the application and authenticated RPC", async () => {
    const { userId, token } = await context.identity(false);
    await createUpdateProfile(authenticated(token)).forUser(userId, {
      displayName: " Alice ", preferredSports: ["Tennis", "Tennis"], preferredRegions: ["West"],
    });
    expect(await profile(userId)).toEqual({
      display_name: "Alice", preferred_sports: ["Tennis"], preferred_regions: ["West"], account_status: "ACTIVE",
    });
  });

  test("denies authenticated direct writes that could bypass the policy", async () => {
    const { userId, token } = await context.identity(false);
    const { error } = await authenticated(token).from("profiles")
      .update({ preferred_sports: [" "] }).eq("user_id", userId);
    expect(error?.code).toBe("42501");
    expect((await profile(userId)).preferred_sports).toEqual([]);
  });

  test("direct RPC callers cannot supply invalid profile edits", async () => {
    const { userId, token } = await context.identity(false);
    const client = authenticated(token);
    for (const overrides of [
      { p_preferred_sports: [" "] },
      { p_preferred_sports: [] },
      { p_preferred_sports: ["Chess"] },
      { p_preferred_regions: [null] },
      { p_preferred_regions: ["Johor"] },
      { p_display_name: "\t\n\uFEFF" },
      { p_display_name: "😀".repeat(31) },
    ]) {
      const { error } = await client.rpc("update_profile", {
        p_user_id: userId, p_display_name: "Alice", p_preferred_sports: ["Tennis"], p_preferred_regions: ["West"],
        ...overrides,
      });
      expect(error?.code).toBe("PRF02");
    }
    expect((await profile(userId)).display_name).toBe("");
  });

  test("binds the RPC to the authenticated identity instead of a submitted user ID", async () => {
    const alice = await context.identity(false);
    const bob = await context.identity(false);
    const { error } = await authenticated(alice.token).rpc("update_profile", {
      p_user_id: bob.userId, p_display_name: "Alice", p_preferred_sports: ["Tennis"], p_preferred_regions: ["West"],
    });
    expect(error?.code).toBe("42501");
    expect((await profile(bob.userId)).display_name).toBe("");
  });

  test("an inactive account with an existing token cannot restore personal fields", async () => {
    const { userId, token } = await context.identity(false);
    await context.pool.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [userId]);
    const { error } = await authenticated(token).rpc("update_profile", {
      p_user_id: userId, p_display_name: "Alice", p_preferred_sports: ["Tennis"], p_preferred_regions: ["West"],
    });
    expect(error?.code).toBe("PRF01");
    expect(await profile(userId)).toEqual({
      display_name: "", preferred_sports: [], preferred_regions: [], account_status: "INACTIVE",
    });
  });

  test("registration defaults and untrusted signup metadata still hydrate complete users", async () => {
    const defaults = await context.identity(false);
    const { data, error } = await context.admin.auth.admin.createUser({
      email: `profile-${randomUUID()}@example.com`, password: `Profile-${randomUUID()}`, email_confirm: true,
      user_metadata: { preferred_sports: [" ", null, {}, "Tennis"], preferred_regions: ["\t", "West"] },
    });
    if (error || !data.user) throw new Error("Could not create profile fixture", { cause: error });
    expect((await profile(defaults.userId)).preferred_sports).toEqual([]);
    expect((await profile(data.user.id)).preferred_sports).toEqual(["Tennis"]);
    expect((await profile(data.user.id)).preferred_regions).toEqual(["West"]);
    for (const userId of [defaults.userId, data.user.id]) {
      const user = await new PostgresTransactor(context.pool).transaction((sql) =>
        new PostgresUserReader(sql, { now: () => new Date() }).get(userId),
      );
      expect(user?.userId).toBe(userId);
    }
  });

  test("a profile edit waiting behind deactivation rechecks the committed inactive state", async () => {
    const { userId } = await context.identity(false);
    const deactivator = await context.pool.connect();
    const editor = await context.pool.connect();
    try {
      await deactivator.query("begin");
      await deactivator.query("update profiles set account_status = 'INACTIVE' where user_id = $1", [userId]);
      await editor.query("begin");
      await editor.query("set local role authenticated");
      await editor.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const { rows } = await editor.query<{ pid: number }>("select pg_backend_pid() as pid");
      const pid = rows[0]?.pid;
      if (pid === undefined) throw new Error("The editor connection has no process ID");
      const attempt = editor.query("select public.update_profile($1, 'Alice', array['Tennis'], array['West'])", [userId])
        .then(() => ({ code: "saved" }), (error: { code: string }) => error);
      let blocked = false;
      for (let attemptCount = 0; attemptCount < 100; attemptCount += 1) {
        const wait = await context.pool.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
        if (wait.rows[0]?.wait_event_type === "Lock") { blocked = true; break; }
        await delay(20);
      }
      expect(blocked).toBe(true);
      await deactivator.query("commit");
      expect(await attempt).toMatchObject({ code: "PRF01" });
      expect((await profile(userId)).display_name).toBe("");
    } finally {
      await deactivator.query("rollback").catch(() => undefined);
      await editor.query("rollback").catch(() => undefined);
      deactivator.release();
      editor.release();
    }
  });
});
