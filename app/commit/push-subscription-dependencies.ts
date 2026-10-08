import type { UUID } from "@/domain";
import type { WebPushSubscription } from "@/lib/commit/web-push-notifier";
import type { Authenticate } from "./http";

/** App-owned capabilities for registering a browser for Web Push. */
export interface PushSubscriptionDependencies {
  readonly authenticate: Authenticate;
  readonly subscriptions: {
    register(userId: UUID, subscription: WebPushSubscription): Promise<void>;
    unregister(userId: UUID, endpoint: string): Promise<void>;
  };
}

export class PushNotificationsUnavailableError extends Error {
  constructor() {
    super("Push notifications are not available");
    this.name = "PushNotificationsUnavailableError";
  }
}
