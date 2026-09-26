import { DomainError } from "../../shared/errors";
import type { SettlementBatch } from "../../shared/operations";
import type { SessionStatus } from "../../shared/statuses";
import type { UUID } from "../../shared/types";
import type { Booking } from "../booking";
import { validDate } from "./session-validation";

/** Pure lifecycle checks shared by role preflight and aggregate recording. */
export function assertOpen(status: SessionStatus): void {
  DomainError.require(
    status === "OPEN",
    "SESSION_CLOSED",
    "The session is not open",
  );
}

export function assertOpenBefore(
  status: SessionStatus,
  booking: Booking,
  at: Date,
): void {
  validDate(at, "now");
  assertOpen(status);
  DomainError.require(
    !booking.hasStarted(at),
    "SESSION_STARTED",
    "The session has started",
  );
}

export function assertAttendanceOpen(
  status: SessionStatus,
  booking: Booking,
  at: Date,
): void {
  validDate(at, "now");
  DomainError.require(
    status === "OPEN",
    "INVALID_STATE",
    "Attendance can only be verified on an open session",
  );
  DomainError.require(
    booking.hasEnded(at),
    "SESSION_NOT_ENDED",
    "Attendance verification requires the session to end",
  );
}

export function assertSettlementOpen(
  status: SessionStatus,
  booking: Booking,
  at: Date,
): void {
  validDate(at, "now");
  DomainError.require(
    status !== "PAYOUT_PENDING",
    "PAYOUT_IN_PROGRESS",
    "A payout is already pending",
  );
  DomainError.require(
    status === "OPEN" || status === "AWAITING_PAYOUT",
    "SESSION_CLOSED",
    "Only an unsettled session can be paid out",
  );
  DomainError.require(
    booking.hasEnded(at),
    "SESSION_NOT_ENDED",
    "Settlement requires the session to end",
  );
}

export function validatePayoutAttempt(
  pendingSettlement: SettlementBatch | undefined,
  payoutAttemptIds: readonly UUID[],
  payoutIdempotencyKeys: readonly string[],
  payoutId: UUID,
  idempotencyKey: string,
): void {
  DomainError.require(
    pendingSettlement === undefined,
    "PAYOUT_IN_PROGRESS",
    "A payout is already pending",
  );
  DomainError.require(
    !payoutAttemptIds.includes(payoutId),
    "DUPLICATE_ID",
    "A payout ID can only be used once for this session",
  );
  DomainError.require(
    !payoutIdempotencyKeys.includes(idempotencyKey),
    "DUPLICATE_ID",
    "A payout idempotency key can only be used once for this session",
  );
}
