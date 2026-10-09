import type { Pool } from "pg";
import type { SqlExecutor } from "@/lib/money/sql";
import { PostgresPushSubscriptionStore } from "./postgres-push-subscription-store";
import { WebPushNotifier } from "./web-push-notifier";
import { type VapidDetails, WebPushSender } from "./web-push-sender";

/**
 * Web Push over the shared pool: the subscription store and a notifier that
 * delivers commitment notifications to every browser a recipient registered.
 * Store queries are single autocommit statements, run after the use case's
 * unit of work commits (CLAUDE.md rule #4).
 */
export function createWebPush(getPool: () => Pool, vapid: VapidDetails) {
  const sql: SqlExecutor = {
    query: async (statement, values) =>
      (await getPool().query(statement, values ? [...values] : undefined)).rows,
  };
  const subscriptions = new PostgresPushSubscriptionStore(sql);
  return {
    subscriptions,
    notifier: new WebPushNotifier(subscriptions, new WebPushSender(vapid)),
  };
}
