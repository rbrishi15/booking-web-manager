import type { UUID } from "@/domain";

export type CommitmentNotification =
  /** A waiting participant took a place; their share is now held. */
  | {
      readonly kind: "PROMOTED";
      readonly recipientId: UUID;
      readonly sessionId: UUID;
    }
  /** Someone withdrew and named the recipient as their replacement. */
  | {
      readonly kind: "REPLACEMENT_INVITATION";
      readonly recipientId: UUID;
      readonly sessionId: UUID;
    }
  /** A late withdrawal: the share stays held and is forfeited at start unless replaced. */
  | {
      readonly kind: "FORFEITURE_WARNING";
      readonly recipientId: UUID;
      readonly sessionId: UUID;
    }
  /** The session started without a replacement; the held share goes to the booker. */
  | {
      readonly kind: "FORFEITURE_DUE";
      readonly recipientId: UUID;
      readonly sessionId: UUID;
    }
  /** The session has ended; the booker should verify attendance. */
  | {
      readonly kind: "VERIFICATION_REMINDER";
      readonly recipientId: UUID;
      readonly sessionId: UUID;
    };

/** Delivers notifications to users, for example by Web Push. */
export interface CommitmentNotifier {
  notify(notifications: readonly CommitmentNotification[]): Promise<void>;
}

/**
 * Sends after the caller's unit of work has committed, never inside it
 * (CLAUDE.md rule #4). Delivery is best-effort: a failed notification must not
 * undo or fail a committed money movement. Because a retried request replays
 * its committed result and notifies again, delivery is at-least-once.
 */
export async function notifyBestEffort(
  notifier: CommitmentNotifier,
  notifications: readonly CommitmentNotification[],
): Promise<void> {
  if (notifications.length === 0) return;
  try {
    await notifier.notify(notifications);
  } catch {
    // Notification delivery never affects the committed outcome.
  }
}
