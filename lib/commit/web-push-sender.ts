import webpush, { WebPushError } from "web-push";
import type { PushDelivery, PushSender, WebPushSubscription } from "./web-push-notifier";

export interface VapidDetails {
  readonly subject: string;
  readonly publicKey: string;
  readonly privateKey: string;
}

/** How long the push service keeps an undelivered message for an offline device. */
const TIME_TO_LIVE_SECONDS = 24 * 60 * 60;

/**
 * Sends one encrypted Web Push message with the `web-push` library and VAPID
 * keys. The push service answering 404 or 410 means the browser unsubscribed,
 * so the subscription is EXPIRED; any other failure is FAILED and the
 * subscription is kept.
 */
export class WebPushSender implements PushSender {
  constructor(
    private readonly vapid: VapidDetails,
    private readonly send_ = webpush.sendNotification,
  ) {}

  async send(subscription: WebPushSubscription, payload: string): Promise<PushDelivery> {
    try {
      await this.send_(
        { endpoint: subscription.endpoint, keys: { ...subscription.keys } },
        payload,
        { vapidDetails: { ...this.vapid }, TTL: TIME_TO_LIVE_SECONDS, urgency: "high" },
      );
      return "DELIVERED";
    } catch (error) {
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410))
        return "EXPIRED";
      return "FAILED";
    }
  }
}
