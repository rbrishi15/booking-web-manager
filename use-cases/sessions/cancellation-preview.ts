import { Money, type FinancialResult, type Session } from "@/domain";

export class CancellationConflict extends Error {
  readonly code = "STALE_CANCELLATION_PREVIEW";
  constructor() {
    super("The session changed. Review the updated refunds before confirming.");
    this.name = "CancellationConflict";
  }
}

/** Reports actual refund instructions, with safe integer-cent accumulation. */
export function cancellationRefundSummary(result: FinancialResult) {
  const refunds = result.instructions.filter((instruction) => instruction.kind === "REFUND");
  return {
    refundRecipientCount: new Set(refunds.map((instruction) => instruction.walletId)).size,
    totalRefundCents: refunds.reduce((total, instruction) => total.add(instruction.amount), Money.fromCents(0)).toCents(),
  };
}

export function affectedParticipantCount(session: Session): number {
  return session.participantList.participations.filter(
    (participation) => participation.status !== "REMOVED" && participation.status !== "CANCELLED",
  ).length;
}
