import {
  PushNotificationsUnavailableError,
  type PushSubscriptionDependencies,
} from "@/app/commit/push-subscription-dependencies";
import { readPushSettings } from "@/app/commit/push-environment";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { createWebPush } from "@/lib/commit/web-push";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { createSupabaseIdentityAuthenticator } from "@/lib/supabase/bearer-auth";

/**
 * Assembles browser registration for Web Push. Without server or VAPID
 * settings every call reports PUSH_UNAVAILABLE, so the client can hide the
 * notifications option.
 */
export function createPushSubscriptionDependencies(): PushSubscriptionDependencies {
  const settings = readSessionServerSettings();
  const push = readPushSettings();
  if (!settings || !push) {
    const unavailable = async (): Promise<never> => {
      throw new PushNotificationsUnavailableError();
    };
    return {
      authenticate: unavailable,
      subscriptions: { register: unavailable, unregister: unavailable },
    };
  }
  const { subscriptions } = createWebPush(
    createPostgresPoolProvider(settings.databaseUrl),
    push,
  );
  return {
    authenticate: createSupabaseIdentityAuthenticator(
      settings.supabaseUrl,
      settings.supabaseAnonKey,
    ),
    subscriptions,
  };
}
