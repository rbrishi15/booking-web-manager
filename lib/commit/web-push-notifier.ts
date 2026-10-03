import type { UUID } from "@/domain";
import type {
  CommitmentNotification,
  CommitmentNotifier,
} from "@/use-cases/sessions/commitment-notifications";

/** A browser's Web Push subscription, as returned by `PushManager.subscribe`. */
export interface WebPushSubscription {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface PushSubscriptionStore {
  subscriptionsFor(userId: UUID): Promise<readonly WebPushSubscription[]>;
  /** Forgets a subscription the push service reports as expired. */
  remove(endpoint: string): Promise<void>;
}

export type PushDelivery = "DELIVERED" | "EXPIRED" | "FAILED";

/**
 * Sends one encrypted payload, typically `webpush.sendNotification` with the
 * VAPID keys. Implementations map HTTP 404/410 from the push service to
 * EXPIRED and other errors to FAILED.
 */
export interface PushSender {
  send(subscription: WebPushSubscription, payload: string): Promise<PushDelivery>;
}

export interface PushPayload {
  readonly title: string;
  readonly body: string;
  /** Where the service worker opens the app when the notification is clicked. */
  readonly url: string;
  readonly kind: CommitmentNotification["kind"];
  readonly sessionId: UUID;
}

/** User-facing text for each notification. Amounts are shown in the app, not here. */
export function pushPayloadFor(
  notification: CommitmentNotification,
): PushPayload {
  const url = `/sessions/${notification.sessionId}`;
  const base = { url, kind: notification.kind, sessionId: notification.sessionId };
  switch (notification.kind) {
    case "PROMOTED":
      return {
        ...base,
        title: "You're in!",
        body: "A place opened up and your share is now held for this session.",
      };
    case "REPLACEMENT_INVITATION":
      return {
        ...base,
        title: "You've been invited to take a place",
        body: "A participant has named you as their replacement. Accept before the session starts.",
      };
    case "FORFEITURE_WARNING":
      return {
        ...base,
        title: "Your share is still held",
        body: "You withdrew within 30 hours of the start. Your share is forfeited to the booker unless someone replaces you before the session starts.",
      };
    case "FORFEITURE_DUE":
      return {
        ...base,
        title: "Your share was forfeited",
        body: "The session started without a replacement, so your held share goes to the booker.",
      };
    case "VERIFICATION_REMINDER":
      return {
        ...base,
        title: "Verify attendance",
        body: "Your session has ended. Mark who attended; unverified participants are marked attended automatically 72 hours after the end.",
      };
  }
}

/**
 * CommitmentNotifier over Web Push. Each notification goes to every
 * subscription its recipient has registered. One failed delivery does not stop
 * the others, and expired subscriptions are removed. Delivery failures are not
 * rethrown: use cases already treat notifications as best-effort.
 */
export class WebPushNotifier implements CommitmentNotifier {
  constructor(
    private readonly subscriptions: PushSubscriptionStore,
    private readonly sender: PushSender,
  ) {}

  async notify(
    notifications: readonly CommitmentNotification[],
  ): Promise<void> {
    await Promise.allSettled(
      notifications.map((notification) => this.deliver(notification)),
    );
  }

  private async deliver(notification: CommitmentNotification): Promise<void> {
    const payload = JSON.stringify(pushPayloadFor(notification));
    const subscriptions = await this.subscriptions.subscriptionsFor(
      notification.recipientId,
    );
    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        const delivery = await this.sender.send(subscription, payload);
        if (delivery === "EXPIRED")
          await this.subscriptions.remove(subscription.endpoint);
      }),
    );
  }
}
