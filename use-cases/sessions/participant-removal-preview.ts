import { DomainError, Money, type FinancialResult, type Session, type User } from "@/domain";

export class ParticipantRemovalConflict extends Error {
  readonly code = "STALE_REMOVAL_PREVIEW";
  constructor() {
    super("This participant or session changed. Review the updated refund before confirming.");
    this.name = "ParticipantRemovalConflict";
  }
}

/** Read-side access to private participant facts; commands still authorize through Booker. */
export function requireParticipantListOwner(user: User, session: Session): void {
  DomainError.require(user.userId === session.bookerId, "UNAUTHORIZED", "Only the booker can manage this session");
}

export function participantRemovalRefundCents(result: FinancialResult): number {
  return result.instructions.filter((instruction) => instruction.kind === "REFUND")
    .reduce((total, instruction) => total.add(instruction.amount), Money.fromCents(0)).toCents();
}
