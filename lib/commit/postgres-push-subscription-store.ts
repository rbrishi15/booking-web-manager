import type { UUID } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { text } from "@/lib/sessions/postgres-row-values";
import type { PushSubscriptionStore, WebPushSubscription } from "./web-push-notifier";

/** Browsers kept per user; registering another forgets the oldest. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Web Push subscriptions in `push_subscriptions` (migration 0009), read and
 * written over the server's direct connection. Every user-initiated change is
 * scoped to the authenticated user ID passed in by the route.
 */
export class PostgresPushSubscriptionStore implements PushSubscriptionStore {
  constructor(private readonly sql: SqlExecutor) {}

  async subscriptionsFor(userId: UUID): Promise<readonly WebPushSubscription[]> {
    const rows = await this.sql.query(
      `select endpoint, p256dh, auth from push_subscriptions
       where user_id = $1 order by created_at desc`,
      [userId],
    );
    return rows.map((row) => ({
      endpoint: text(row.endpoint),
      keys: { p256dh: text(row.p256dh), auth: text(row.auth) },
    }));
  }

  async remove(endpoint: string): Promise<void> {
    await this.sql.query("delete from push_subscriptions where endpoint = $1", [endpoint]);
  }

  /**
   * Saves this browser's subscription for the user. An endpoint identifies
   * one browser installation, so re-registering it (for example after another
   * account signed in on the same device) moves it to this user.
   */
  async register(userId: UUID, subscription: WebPushSubscription): Promise<void> {
    await this.sql.query(
      `with saved as (
         insert into push_subscriptions (endpoint, user_id, p256dh, auth)
         values ($1, $2, $3, $4)
         on conflict (endpoint) do update
           set user_id = excluded.user_id, p256dh = excluded.p256dh,
               auth = excluded.auth, created_at = now()
         returning endpoint
       )
       delete from push_subscriptions
       where user_id = $2
         and endpoint not in (select endpoint from saved)
         and endpoint not in (
           select endpoint from push_subscriptions
           where user_id = $2
           order by created_at desc
           limit $5
         )`,
      [
        subscription.endpoint,
        userId,
        subscription.keys.p256dh,
        subscription.keys.auth,
        MAX_SUBSCRIPTIONS_PER_USER - 1,
      ],
    );
  }

  /** Forgets one of the user's own subscriptions; another user's is untouched. */
  async unregister(userId: UUID, endpoint: string): Promise<void> {
    await this.sql.query(
      "delete from push_subscriptions where endpoint = $1 and user_id = $2",
      [endpoint, userId],
    );
  }
}
