import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { UUID } from "@/domain";
import {
  MAX_SUBSCRIPTIONS_PER_USER,
  PostgresPushSubscriptionStore,
} from "@/lib/commit/postgres-push-subscription-store";

/**
 * Runs the Web Push subscription store against a real database with
 * migration 0009 applied. Skipped unless `COMMITMENT_TEST_DATABASE_URL` points
 * at a throwaway database (see postgres-scheduled-jobs.db.test.ts).
 */
const DATABASE_URL = process.env.COMMITMENT_TEST_DATABASE_URL;

describe.skipIf(!DATABASE_URL)("PostgresPushSubscriptionStore (database)", () => {
  let pool: Pool;
  let store: PostgresPushSubscriptionStore;

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
    store = new PostgresPushSubscriptionStore({
      query: async (text, values) => (await pool.query(text, values ? [...values] : undefined)).rows,
    });
  });
  afterAll(async () => pool?.end());

  test("registers, re-registers in place and lists a user's browsers", async () => {
    const alice = await createUser();
    const first = subscription();

    await store.register(alice, first);
    await store.register(alice, { ...first, keys: { p256dh: "rotated", auth: "rotated-auth" } });

    expect(await store.subscriptionsFor(alice)).toEqual([
      { endpoint: first.endpoint, keys: { p256dh: "rotated", auth: "rotated-auth" } },
    ]);
  });

  test("a browser registered by another account moves to that account", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const shared = subscription();
    await store.register(alice, shared);

    await store.register(bob, shared);

    expect(await store.subscriptionsFor(alice)).toEqual([]);
    expect(await store.subscriptionsFor(bob)).toEqual([shared]);
  });

  test(`keeps at most ${MAX_SUBSCRIPTIONS_PER_USER} browsers per user, forgetting the oldest`, async () => {
    const alice = await createUser();
    const registered = [];
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER + 2; i += 1) {
      const next = subscription();
      await store.register(alice, next);
      registered.push(next.endpoint);
    }

    const kept = (await store.subscriptionsFor(alice)).map((s) => s.endpoint);

    expect(kept).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
    expect(kept).toEqual(registered.slice(2).reverse());
  });

  test("unregister removes only the caller's own subscription", async () => {
    const [alice, bob] = [await createUser(), await createUser()];
    const alices = subscription();
    await store.register(alice, alices);

    await store.unregister(bob, alices.endpoint);
    expect(await store.subscriptionsFor(alice)).toEqual([alices]);

    await store.unregister(alice, alices.endpoint);
    expect(await store.subscriptionsFor(alice)).toEqual([]);
  });

  test("remove forgets an expired endpoint", async () => {
    const alice = await createUser();
    const expired = subscription();
    await store.register(alice, expired);

    await store.remove(expired.endpoint);

    expect(await store.subscriptionsFor(alice)).toEqual([]);
  });

  async function createUser(): Promise<UUID> {
    const id = randomUUID();
    await pool.query(
      "insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
      [id, `${id}@example.com`],
    );
    return id;
  }

  function subscription() {
    return {
      endpoint: `https://push.example.com/${randomUUID()}`,
      keys: { p256dh: `p256dh-${randomUUID()}`, auth: "auth" },
    };
  }
});
