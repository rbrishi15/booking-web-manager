import { DomainError } from "../shared/errors";
import type { FinancialInstruction } from "../shared/operations";
import type { UUID } from "../shared/types";
import type { Participation } from "./participation";
import { validDate } from "./session/session-validation";

/** Describe ledger effects without writing entries or changing domain state. */
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
    sessionId,
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
    sessionId,
    participationId: participation.participationId,
    holdId: hold.holdId,
    holdingAccountId: hold.holdingAccountId,
    walletId: hold.walletId,
    amount: hold.amount,
    occurredAt: validDate(at, "at"),
  };
}
