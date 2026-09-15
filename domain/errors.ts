export type DomainErrorCode =
  | "INVALID_STATE"
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "INACTIVE_ACCOUNT"
  | "SESSION_CLOSED"
  | "SESSION_STARTED"
  | "SESSION_NOT_ENDED"
  | "AUTO_VERIFICATION_NOT_DUE"
  | "CAPACITY_EXCEEDED"
  | "ALREADY_PARTICIPATING"
  | "REJOIN_NOT_ALLOWED"
  | "LOW_RELIABILITY"
  | "INSUFFICIENT_FUNDS"
  | "INVALID_ACCESS"
  | "INVALID_INVITATION"
  | "NOT_FOUND"
  | "WAITLIST_NOT_HEAD"
  | "ATTENDANCE_CONFLICT"
  | "ATTENDANCE_INCOMPLETE"
  | "PAYOUT_IN_PROGRESS"
  | "PAYOUT_ACCOUNT_NOT_READY"
  | "STALE_PAYOUT"
  | "PAYOUT_CONFLICT"
  | "ACTIVE_OBLIGATIONS"
  | "OWNER_REMOVAL"
  | "DUPLICATE_ID";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function requireDomain(
  condition: unknown,
  code: DomainErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
