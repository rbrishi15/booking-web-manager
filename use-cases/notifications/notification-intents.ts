import type { UUID } from "@/domain";

export type NotificationKind =
  | "PROMOTED" | "REMOVED_FROM_WAITLIST" | "REPLACEMENT_INVITATION"
  | "FORFEITURE_WARNING" | "FORFEITURE_DUE" | "VERIFICATION_REMINDER"
  | "GROUP_INVITATION" | "GROUP_INVITATION_ACCEPTED" | "GROUP_INVITATION_DECLINED"
  | "GROUP_MEMBER_JOINED" | "GROUP_MEMBER_LEFT" | "GROUP_MEMBER_REMOVED"
  | "GROUP_RENAMED" | "GROUP_ARCHIVED" | "GROUP_INVITATION_ENDED"
  | "GROUP_BOOKING_CREATED" | "SESSION_INVITATION" | "BOOKING_JOINED" | "WAITLIST_ENTERED"
  | "REPLACEMENT_ACCEPTED" | "REPLACEMENT_REFUNDED" | "BOOKING_CANCELLED" | "PARTICIPANT_REMOVED";

/** Application facts only: adapters render and persist the canonical message in the current transaction. */
export interface NotificationIntent {
  readonly kind: NotificationKind;
  readonly recipientId: UUID;
  readonly sessionId?: UUID;
  readonly groupId?: UUID;
  readonly occurrenceKey?: string;
  readonly subjectName?: string;
  /** Only used to create a private invitation URL for its intended recipient. */
  readonly invitationToken?: string;
  readonly reason?: string;
  readonly refundCents?: number;
  readonly expiresAt?: Date;
  readonly startAt?: Date;
}

export interface NotificationWriter {
  append(intents: readonly NotificationIntent[]): Promise<void>;
  /** Current members from the same transaction snapshot; no notification-history dependency. */
  groupMembers(groupId: UUID): Promise<readonly UUID[]>;
}
