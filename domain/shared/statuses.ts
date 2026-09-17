export type AccountStatus = "ACTIVE" | "INACTIVE";
export type Visibility = "PRIVATE" | "PUBLIC";
export type SessionStatus =
  | "OPEN"
  | "CANCELLED"
  | "AWAITING_PAYOUT"
  | "PAYOUT_PENDING"
  | "SETTLED";
export type ParticipationStatus =
  | "WAITLISTED"
  | "COMMITTED"
  | "LEFT_WAITLIST"
  | "WITHDRAWN"
  | "REMOVED"
  | "CANCELLED";
export type ReplacementMode = "OPEN_SLOT" | "INVITE_LINK";
export type AttendanceStatus = "UNVERIFIED" | "ATTENDED" | "ABSENT";
export type VerificationMethod = "BOOKER" | "AUTOMATIC";
export type HoldState =
  | "HELD"
  | "AWAITING_REPLACEMENT"
  | "FORFEITURE_DUE"
  | "RELEASED"
  | "REFUNDED"
  | "FORFEITED";
export type PayoutStatus = "REQUESTED" | "COMPLETED" | "FAILED";
export type PayoutSetupStatus = "PENDING" | "COMPLETE" | "FAILED";
export type GroupStatus = "ACTIVE" | "ARCHIVED";
export type TransactionKind =
  | "TOP_UP"
  | "LOCK"
  | "RELEASE"
  | "REFUND"
  | "FORFEIT"
  | "PAYOUT";
