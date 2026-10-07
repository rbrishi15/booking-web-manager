import type { CommitmentNotifier } from "@/use-cases/sessions/commitment-notifications";

/**
 * Accepts commitment notifications without delivering them. Used until Web
 * Push subscriptions and a push sender are configured; the workflows treat
 * delivery as best-effort, so nothing else changes when it is replaced by
 * WebPushNotifier.
 */
export class NoDeliveryNotifier implements CommitmentNotifier {
  async notify(): Promise<void> {}
}
