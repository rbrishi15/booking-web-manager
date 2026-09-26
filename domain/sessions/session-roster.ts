import { DomainError } from "../shared/errors";
import type {
  FinancialInstruction,
  FinancialResult,
  WithdrawalResult,
} from "../shared/operations";
import type { Booking } from "./booking";
import type { Session } from "./session";
import type { UUID } from "../shared/types";
import type { Participation } from "./participation";
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

export function lockInstruction(
  sessionId: UUID,
  participation: Participation,
  at: Date,
): FinancialInstruction {
  const hold = participation.hold;
  if (hold === undefined)
    throw new DomainError("INVALID_STATE", "A commitment needs a hold");
  return {
    kind: "LOCK",
    sessionId: sessionId,
    participationId: participation.participationId,
    holdId: hold.holdId,
    holdingAccountId: hold.holdingAccountId,
    walletId: hold.walletId,
    amount: hold.amount,
    occurredAt: validDate(at, "at"),
  };
}

export function refundInstruction(
  sessionId: UUID,
  participation: Participation,
  at: Date,
): FinancialInstruction {
  const hold = participation.hold;
  if (hold === undefined)
    throw new DomainError("INVALID_STATE", "A refund needs a hold");
  return {
    kind: "REFUND",
    sessionId: sessionId,
    participationId: participation.participationId,
    holdId: hold.holdId,
    holdingAccountId: hold.holdingAccountId,
    walletId: hold.walletId,
    amount: hold.amount,
    occurredAt: validDate(at, "at"),
  };
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

interface RosterChange<Result> {
  readonly participations: Participation[];
  readonly result: Result;
}

export function leaveWaitlist(
  participations: readonly Participation[],
  command: Parameters<Session["leaveWaitlist"]>[0],
): Participation[] {
  const participation = requireParticipation(
    participations,
    command.participationId,
  );
  DomainError.require(
    participation.userId === command.actorId,
    "UNAUTHORIZED",
    "Only the participant can leave the waitlist",
  );
  return replaceParticipation(
    participations,
    participation.participationId,
    participation.leaveWaitlist(),
  );
}

export function withdrawParticipant(
  sessionId: UUID,
  participations: readonly Participation[],
  booking: Booking,
  command: Parameters<Session["withdrawParticipant"]>[0],
): RosterChange<WithdrawalResult> {
  const participation = requireParticipation(
    participations,
    command.participationId,
  );
  DomainError.require(
    participation.userId === command.actorId,
    "UNAUTHORIZED",
    "Only the participant can withdraw",
  );
  DomainError.require(
    participation.status === "COMMITTED" && participation.hold !== undefined,
    "INVALID_STATE",
    "Only a committed participant can withdraw",
  );
  const hold = participation.hold;
  const late = booking.hoursUntilStart(command.now) <= 30;
  const nextHold = late ? hold.awaitReplacement() : hold.refund(command.now);
  const next = participation.withdraw(
    nextHold,
    command.now,
    late ? (command.replacementMode ?? "OPEN_SLOT") : undefined,
    late ? command.replacementToken : undefined,
  );
  return {
    participations: replaceParticipation(
      participations,
      participation.participationId,
      next,
    ),
    result: {
      kind: late ? "AWAITING_REPLACEMENT" : "REFUNDED",
      participationId: participation.participationId,
      instructions: late
        ? []
        : [refundInstruction(sessionId, next, command.now)],
    },
  };
}

export function offerReplacementToWaitlist(
  participations: readonly Participation[],
  command: Parameters<Session["offerReplacementToWaitlist"]>[0],
): RosterChange<FinancialResult> {
  const participation = requireParticipation(
    participations,
    command.participationId,
  );
  DomainError.require(
    participation.userId === command.actorId,
    "UNAUTHORIZED",
    "Only the participant can offer their replacement to the waitlist",
  );
  const offered = participation.offerReplacementToWaitlist();
  const next = replaceParticipation(
    participations,
    participation.participationId,
    offered,
  );
  const result: FinancialResult = { instructions: [] };
  return { participations: next, result };
}

export function removeParticipant(
  sessionId: UUID,
  participations: readonly Participation[],
  command: Parameters<Session["removeParticipant"]>[0],
): RosterChange<FinancialResult> {
  const participation = requireParticipation(
    participations,
    command.participationId,
  );
  DomainError.require(
    participation.status === "COMMITTED" && participation.hold !== undefined,
    "INVALID_STATE",
    "Only a committed participant can be removed",
  );
  const nextHold = participation.hold.refund(command.now);
  const next = participation.remove(nextHold);
  return {
    participations: replaceParticipation(
      participations,
      participation.participationId,
      next,
    ),
    result: { instructions: [refundInstruction(sessionId, next, command.now)] },
  };
}

export function cancelRoster(
  sessionId: UUID,
  participations: readonly Participation[],
  now: Date,
): RosterChange<FinancialResult> {
  const instructions: FinancialInstruction[] = [];
  let next = [...participations];
  for (const participation of participations) {
    let changed: Participation;
    if (
      participation.hold !== undefined &&
      !["REFUNDED", "RELEASED", "FORFEITED"].includes(participation.hold.state)
    ) {
      const refundedHold = participation.hold.refund(now);
      changed = participation.cancel(refundedHold);
      instructions.push(refundInstruction(sessionId, changed, now));
    } else {
      changed = participation.cancel();
    }
    next = replaceParticipation(next, participation.participationId, changed);
  }
  return { participations: next, result: { instructions } };
}

export function expireReplacements(
  participations: readonly Participation[],
  now: Date,
): Participation[] {
  return participations.map((participation) =>
    participation.expireReplacement(now),
  );
}

export function verifyAttendance(
  participations: readonly Participation[],
  command: Parameters<Session["verifyAttendance"]>[0],
): AttendanceChange {
  const markedIds = new Set<UUID>();
  let next = [...participations];
  for (const mark of command.marks) {
    DomainError.require(
      !markedIds.has(mark.participationId),
      "DUPLICATE_ID",
      "A participation may be verified only once per command",
    );
    markedIds.add(mark.participationId);
    const participation = requireParticipation(
      participations,
      mark.participationId,
    );
    const verified = participation.verify(
      mark.attendance,
      "BOOKER",
      command.now,
    );
    next = replaceParticipation(next, participation.participationId, verified);
  }
  return { participations: next, status: attendanceStatus(next) };
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

function attendanceStatus(
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
