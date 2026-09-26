import { DomainError } from "../../shared/errors";
import type { UUID } from "../../shared/types";
import type { Booking } from "../booking";
import type { Participation } from "../participation";
import { validDate } from "./session-validation";

export function oldestAwaiting(
  participations: readonly Participation[],
): Participation | undefined {
  return participations
    .filter(
      (p) =>
        p.status === "WITHDRAWN" && p.hold?.state === "AWAITING_REPLACEMENT",
    )
    .sort(
      (a, b) =>
        (a.withdrawnAt?.getTime() ?? 0) - (b.withdrawnAt?.getTime() ?? 0),
    )[0];
}

export function requireParticipation(
  participations: readonly Participation[],
  id: UUID,
): Participation {
  const result = participations.find((p) => p.participationId === id);
  if (result === undefined)
    throw new DomainError("NOT_FOUND", "Participation was not found");
  return result;
}

export function nextWaitlisted(
  participations: readonly Participation[],
): Participation | undefined {
  return participations
    .filter((p) => p.status === "WAITLISTED")
    .sort((a, b) => (a.queueSequence ?? 0) - (b.queueSequence ?? 0))[0];
}

export function replaceParticipation(
  source: readonly Participation[],
  id: UUID,
  value: Participation,
): Participation[] {
  return source.map((candidate) =>
    candidate.participationId === id ? value : candidate,
  );
}

export function expireReplacements(
  participations: readonly Participation[],
  now: Date,
): Participation[] {
  return participations.map((participation) =>
    participation.expireReplacement(now),
  );
}

export function autoVerifyAttendance(
  participations: readonly Participation[],
  booking: Booking,
  now: Date,
): AttendanceChange {
  const end = booking.endAt.getTime();
  DomainError.require(
    validDate(now, "now").getTime() >= end + 72 * 3_600_000,
    "AUTO_VERIFICATION_NOT_DUE",
    "Automatic verification is not due",
  );
  const next = participations.map((participation) =>
    participation.status === "COMMITTED" &&
    participation.attendance === "UNVERIFIED"
      ? participation.verify("ATTENDED", "AUTOMATIC", now)
      : participation,
  );
  return { participations: next, status: attendanceStatus(next) };
}

interface AttendanceChange {
  readonly participations: Participation[];
  readonly status: "OPEN" | "AWAITING_PAYOUT";
}

export function attendanceStatus(
  participations: readonly Participation[],
): AttendanceChange["status"] {
  const committed = participations.filter((p) => p.status === "COMMITTED");
  return committed.every((p) => p.attendance !== "UNVERIFIED")
    ? "AWAITING_PAYOUT"
    : "OPEN";
}

export function availableSlots(
  participations: readonly Participation[],
  totalSlots: number,
): number {
  return Math.max(
    0,
    totalSlots - participations.filter((p) => p.status === "COMMITTED").length,
  );
}
