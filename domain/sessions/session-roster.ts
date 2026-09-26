import { DomainError } from "../shared/errors";
import type { FinancialInstruction } from "../shared/operations";
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
