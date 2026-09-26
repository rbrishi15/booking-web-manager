import { DomainError } from "../../shared/errors";
import type { Participation } from "../participation";
import type { SessionSettlementPreparation } from "./session";
import {
  availableSlots,
  nextWaitlisted,
  oldestAwaiting,
  requireParticipation,
} from "./session-roster";

function sameDate(a: Date | undefined, b: Date | undefined): boolean {
  return a?.getTime() === b?.getTime();
}

function assertIdentity(before: Participation, after: Participation): void {
  DomainError.require(
    before.participationId === after.participationId &&
      before.userId === after.userId,
    "INVALID_INPUT",
    "A participation must retain its identity and user",
  );
}

function assertEnrollmentUnchanged(
  before: Participation,
  after: Participation,
): void {
  assertIdentity(before, after);
  DomainError.require(
    before.queueSequence === after.queueSequence &&
      sameDate(before.waitlistedAt, after.waitlistedAt) &&
      sameDate(before.committedAt, after.committedAt) &&
      before.replacesParticipationId === after.replacesParticipationId,
    "INVALID_INPUT",
    "An existing participation must retain its enrollment history",
  );
}

function assertAttendanceUnchanged(
  before: Participation,
  after: Participation,
): void {
  DomainError.require(
    before.attendance === after.attendance &&
      sameDate(before.verifiedAt, after.verifiedAt) &&
      before.verificationMethod === after.verificationMethod,
    "INVALID_INPUT",
    "This transition cannot change attendance",
  );
}

function assertReplacementUnchanged(
  before: Participation,
  after: Participation,
): void {
  DomainError.require(
    sameDate(before.withdrawnAt, after.withdrawnAt) &&
      before.replacementMode === after.replacementMode &&
      before.replacementToken === after.replacementToken,
    "INVALID_INPUT",
    "This transition cannot change replacement details",
  );
}

function assertHoldIdentity(before: Participation, after: Participation): void {
  const previous = before.hold;
  const next = after.hold;
  if (previous === undefined) {
    DomainError.require(
      next === undefined,
      "INVALID_INPUT",
      "This transition cannot add a hold",
    );
    return;
  }
  DomainError.require(
    next !== undefined &&
      previous.holdId === next.holdId &&
      previous.participationId === next.participationId &&
      previous.holdingAccountId === next.holdingAccountId &&
      previous.walletId === next.walletId &&
      previous.amount.equals(next.amount) &&
      sameDate(previous.createdAt, next.createdAt),
    "INVALID_INPUT",
    "An existing hold must retain its identity, source, amount, and creation time",
  );
}

function assertRefund(
  before: Participation,
  after: Participation,
  now: Date,
): void {
  assertHoldIdentity(before, after);
  DomainError.require(
    after.hold?.state === "REFUNDED" && sameDate(after.hold.settledAt, now),
    "INVALID_STATE",
    "The prepared refund must settle the existing hold at the operation time",
  );
}

function assertFullRoster(
  before: readonly Participation[],
  after: readonly Participation[],
): void {
  DomainError.require(
    before.length === after.length,
    "INVALID_INPUT",
    "The complete owned roster is required",
  );
  DomainError.require(
    new Set(after.map((p) => p.participationId)).size === after.length,
    "DUPLICATE_ID",
    "A roster cannot repeat a participation",
  );
  for (const next of after)
    assertIdentity(requireParticipation(before, next.participationId), next);
}

/** Checks a prepared enrollment and its coupled refund without constructing either. */
export function validateAdmission(
  roster: readonly Participation[],
  admission: Participation,
  refunded: Participation | undefined,
  totalSlots: number,
  nextQueueSequence: number,
  now: Date,
): void {
  DomainError.require(
    admission.status === "WAITLISTED" || admission.status === "COMMITTED",
    "INVALID_STATE",
    "Admission requires a waiting or committed participation",
  );
  const existing = roster.find((p) => p.userId === admission.userId);
  const waiter = nextWaitlisted(roster);
  if (existing !== undefined) {
    DomainError.require(
      existing.participationId === admission.participationId,
      "DUPLICATE_ID",
      "Re-entry must retain the existing participation ID",
    );
    const promoting =
      existing.status === "WAITLISTED" && admission.status === "COMMITTED";
    DomainError.require(
      existing.status === "LEFT_WAITLIST" || promoting,
      existing.status === "WITHDRAWN" || existing.status === "REMOVED"
        ? "REJOIN_NOT_ALLOWED"
        : "ALREADY_PARTICIPATING",
      "This user already has a participation",
    );
    if (promoting)
      DomainError.require(
        existing.queueSequence === admission.queueSequence &&
          sameDate(existing.waitlistedAt, admission.waitlistedAt),
        "INVALID_INPUT",
        "Promotion must retain the waitlist position",
      );
  }
  DomainError.require(
    !roster.some(
      (p) =>
        p.participationId === admission.participationId &&
        p.userId !== admission.userId,
    ),
    "DUPLICATE_ID",
    "Participation IDs must be unique",
  );
  DomainError.require(
    admission.attendance === "UNVERIFIED",
    "INVALID_STATE",
    "Admission cannot carry attendance",
  );
  if (admission.status === "WAITLISTED") {
    DomainError.require(
      availableSlots(roster, totalSlots) === 0 || waiter !== undefined,
      "INVALID_STATE",
      "An available place without a queue requires a commitment",
    );
    DomainError.require(
      Number.isSafeInteger(nextQueueSequence) &&
        nextQueueSequence < Number.MAX_SAFE_INTEGER &&
        admission.queueSequence === nextQueueSequence,
      "INVALID_INPUT",
      "A waitlist entry must use the next queue sequence",
    );
    DomainError.require(
      sameDate(admission.waitlistedAt, now) &&
        admission.committedAt === undefined &&
        admission.withdrawnAt === undefined &&
        admission.replacesParticipationId === undefined,
      "INVALID_INPUT",
      "A waitlist entry must have fresh waitlist metadata",
    );
    DomainError.require(
      refunded === undefined,
      "INVALID_STATE",
      "Waitlisting cannot refund a replacement",
    );
    return;
  }
  DomainError.require(
    availableSlots(roster, totalSlots) > 0,
    "CAPACITY_EXCEEDED",
    "There is no available slot",
  );
  DomainError.require(
    waiter === undefined || waiter === existing,
    "WAITLIST_NOT_HEAD",
    "Only the first waiter may take the available place",
  );
  DomainError.require(
    admission.hold?.state === "HELD" &&
      sameDate(admission.committedAt, now) &&
      sameDate(admission.hold.createdAt, now),
    "INVALID_STATE",
    "A commitment requires a newly held share",
  );
  if (existing?.status !== "WAITLISTED")
    DomainError.require(
      admission.queueSequence === undefined &&
        admission.waitlistedAt === undefined,
      "INVALID_INPUT",
      "A direct commitment cannot carry a queue position",
    );
  const awaiting = oldestAwaiting(roster);
  DomainError.require(
    admission.replacesParticipationId === awaiting?.participationId,
    "INVALID_STATE",
    "A commitment must replace the oldest awaiting withdrawal",
  );
  if (awaiting === undefined) {
    DomainError.require(
      refunded === undefined,
      "INVALID_STATE",
      "There is no replacement to refund",
    );
    return;
  }
  DomainError.require(
    refunded !== undefined &&
      refunded.participationId === awaiting.participationId,
    "INVALID_STATE",
    "The oldest awaiting withdrawal must be refunded with the commitment",
  );
  assertEnrollmentUnchanged(awaiting, refunded);
  assertAttendanceUnchanged(awaiting, refunded);
  assertReplacementUnchanged(awaiting, refunded);
  DomainError.require(
    refunded.status === "WITHDRAWN",
    "INVALID_STATE",
    "A replacement refund must retain the withdrawal",
  );
  assertRefund(awaiting, refunded, now);
}

export function validateParticipationTransition(
  before: Participation,
  after: Participation,
  now?: Date,
): void {
  assertEnrollmentUnchanged(before, after);
  assertAttendanceUnchanged(before, after);
  assertHoldIdentity(before, after);
  if (before.status === "WAITLISTED" && after.status === "LEFT_WAITLIST") {
    assertReplacementUnchanged(before, after);
    return;
  }
  DomainError.require(
    now !== undefined,
    "INVALID_INPUT",
    "This transition requires an operation time",
  );
  if (before.status === "COMMITTED" && after.status === "WITHDRAWN") {
    DomainError.require(
      before.hold?.state === "HELD" && sameDate(after.withdrawnAt, now),
      "INVALID_STATE",
      "Withdrawal requires an active commitment and withdrawal time",
    );
    DomainError.require(
      after.hold?.state === "REFUNDED" ||
        after.hold?.state === "AWAITING_REPLACEMENT",
      "INVALID_STATE",
      "Withdrawal requires a refund or pending replacement",
    );
    if (after.hold.state === "REFUNDED") assertRefund(before, after, now);
    return;
  }
  if (before.status === "COMMITTED" && after.status === "REMOVED") {
    assertReplacementUnchanged(before, after);
    DomainError.require(
      before.hold?.state === "HELD",
      "INVALID_STATE",
      "Removal requires an active commitment",
    );
    assertRefund(before, after, now);
    return;
  }
  DomainError.require(
    before.status === "WITHDRAWN" &&
      after.status === "WITHDRAWN" &&
      before.hold?.state === "AWAITING_REPLACEMENT" &&
      after.hold === before.hold &&
      before.replacementMode === "INVITE_LINK" &&
      after.replacementMode === "OPEN_SLOT" &&
      after.replacementToken === undefined &&
      sameDate(before.withdrawnAt, after.withdrawnAt),
    "INVALID_STATE",
    "This participation transition is not permitted",
  );
}

export function validateCancellation(
  roster: readonly Participation[],
  cancelled: readonly Participation[],
  now: Date,
): void {
  assertFullRoster(roster, cancelled);
  for (const next of cancelled) {
    const previous = requireParticipation(roster, next.participationId);
    assertEnrollmentUnchanged(previous, next);
    assertAttendanceUnchanged(previous, next);
    assertHoldIdentity(previous, next);
    DomainError.require(
      ["WAITLISTED", "LEFT_WAITLIST", "COMMITTED", "WITHDRAWN"].includes(
        previous.status,
      ) && next.status === "CANCELLED",
      "INVALID_STATE",
      "The complete roster must transition to cancelled",
    );
    DomainError.require(
      sameDate(previous.withdrawnAt, next.withdrawnAt),
      "INVALID_INPUT",
      "Cancellation cannot rewrite withdrawal history",
    );
    if (previous.hold === undefined) continue;
    if (["REFUNDED", "RELEASED", "FORFEITED"].includes(previous.hold.state)) {
      DomainError.require(
        next.hold === previous.hold,
        "INVALID_STATE",
        "Terminal funds must remain unchanged",
      );
    } else assertRefund(previous, next, now);
  }
}

export function validateAttendanceChanges(
  roster: readonly Participation[],
  verified: readonly Participation[],
  now: Date,
): void {
  const ids = new Set<string>();
  for (const next of verified) {
    DomainError.require(
      !ids.has(next.participationId),
      "DUPLICATE_ID",
      "A participation may be verified only once per command",
    );
    ids.add(next.participationId);
    const previous = requireParticipation(roster, next.participationId);
    assertEnrollmentUnchanged(previous, next);
    assertReplacementUnchanged(previous, next);
    DomainError.require(
      previous.status === "COMMITTED" &&
        next.status === "COMMITTED" &&
        previous.hold === next.hold,
      "INVALID_STATE",
      "Attendance must retain the existing commitment and hold",
    );
    DomainError.require(
      previous.attendance === "UNVERIFIED",
      "ATTENDANCE_CONFLICT",
      "Attendance has already been verified",
    );
    DomainError.require(
      next.attendance !== "UNVERIFIED" &&
        next.verificationMethod === "BOOKER" &&
        sameDate(next.verifiedAt, now),
      "INVALID_INPUT",
      "A manual mark needs its outcome, method, and operation time",
    );
  }
}

export function validateSettlementPreparation(
  roster: readonly Participation[],
  preparation: SessionSettlementPreparation,
  bookerId: string,
  sessionId: string,
  now: Date,
): void {
  const next = preparation.participations;
  assertFullRoster(roster, next);
  for (const candidate of next) {
    const previous = requireParticipation(roster, candidate.participationId);
    assertEnrollmentUnchanged(previous, candidate);
    assertAttendanceUnchanged(previous, candidate);
    assertReplacementUnchanged(previous, candidate);
    assertHoldIdentity(previous, candidate);
    DomainError.require(
      previous.status === candidate.status,
      "INVALID_STATE",
      "Settlement preparation cannot change enrollment",
    );
    if (
      previous.status === "WITHDRAWN" &&
      previous.hold?.state === "AWAITING_REPLACEMENT"
    ) {
      DomainError.require(
        candidate.hold?.state === "FORFEITURE_DUE",
        "INVALID_STATE",
        "Awaiting replacements must expire before settlement",
      );
    } else
      DomainError.require(
        previous.hold === candidate.hold,
        "INVALID_STATE",
        "Settlement preparation cannot alter other holds",
      );
  }
  DomainError.require(
    next.every(
      (p) => p.status !== "COMMITTED" || p.attendance !== "UNVERIFIED",
    ),
    "ATTENDANCE_INCOMPLETE",
    "All committed participants must be finalized before settlement",
  );
  const payable = next.filter(
    (p) =>
      (p.status === "COMMITTED" || p.status === "WITHDRAWN") &&
      (p.hold?.state === "HELD" || p.hold?.state === "FORFEITURE_DUE"),
  );
  const batch = preparation.batch;
  if (batch === undefined) {
    DomainError.require(
      payable.length === 0,
      "INVALID_STATE",
      "Payable holds require a settlement batch",
    );
    return;
  }
  DomainError.require(
    batch.sessionId === sessionId &&
      batch.destination.userId === bookerId &&
      batch.payoutId === preparation.payoutId &&
      batch.idempotencyKey === preparation.idempotencyKey &&
      sameDate(batch.requestedAt, now),
    "INVALID_INPUT",
    "Settlement batch must match this session, destination, and payout attempt",
  );
  DomainError.require(
    payable.length > 0 &&
      batch.lines.length === payable.length &&
      payable.every((p) =>
        batch.lines.some((line) => line.holdId === p.hold?.holdId),
      ),
    "INVALID_INPUT",
    "Settlement must include every payable hold exactly once",
  );
}
