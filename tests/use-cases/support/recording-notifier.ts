import type {
  CommitmentNotification,
  CommitmentNotifier,
} from "@/use-cases/sessions/commitment-notifications";

/** Records delivered notifications; can be told to fail the next delivery. */
export class RecordingNotifier implements CommitmentNotifier {
  readonly sent: CommitmentNotification[] = [];
  failNext = false;

  async notify(notifications: readonly CommitmentNotification[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Push service unavailable");
    }
    this.sent.push(...notifications);
  }

  /** Delivered notifications as [kind, recipient] pairs. */
  deliveries(): [string, string][] {
    return this.sent.map((notification) => [
      notification.kind,
      notification.recipientId,
    ]);
  }
}
