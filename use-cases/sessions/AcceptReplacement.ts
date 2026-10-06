import type { UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { appendInstructions, requireAggregate } from "../shared/helpers";

export interface AcceptReplacementRequest {
  /** The authenticated invitee; their identity authorizes the reservation. */
  readonly userId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
}

export interface AcceptReplacementResult {
  readonly sessionId: UUID;
  readonly participationId: UUID;
  /** Cents moved from the invitee's available funds to held. */
  readonly heldCents: number;
  /** The late withdrawal refunded by this replacement, if its share was still held. */
  readonly refundedParticipationId?: UUID;
}

/**
 * UC2-05 replacement: the person named in a withdrawal's invitation takes
 * that reserved place (ADR-0006).
 *
 * In one unit of work, runs `Participant.acceptReplacement`, which checks the
 * pending invitation, eligibility and funding, then saves the session and
 * appends the invitee's LOCK together with the REFUND for a late-withdrawing
 * participant they replace. Failure leaves the reservation and any existing
 * waitlist position unchanged. An invitee already on the waitlist keeps their
 * participation ID.
 */
export class AcceptReplacement {
  constructor(
    private readonly dependencies: Pick<
      UseCaseDependencies,
      "unitOfWork" | "clock" | "ids"
    >,
  ) {}

  async forInvitee(
    request: AcceptReplacementRequest,
  ): Promise<AcceptReplacementResult> {
    const { unitOfWork, clock, ids } = this.dependencies;
    const key = JSON.stringify([
      "UC2-05-accept-replacement",
      request.userId,
      request.sessionId,
      request.idempotencyKey,
    ]);

    return unitOfWork.execute(key, async (transaction) => {
      const user = await requireAggregate(
        transaction.users,
        request.userId,
        "User",
      );
      const session = await requireAggregate(
        transaction.sessions,
        request.sessionId,
        "Session",
      );
      const existing = session.participantList.findByUserId(user.userId);

      const result = user.asParticipant().acceptReplacement(session, {
        participationId: existing?.participationId ?? ids.next(),
        holdId: ids.next(),
        now: clock.now(),
      });

      await transaction.sessions.save(session);
      await appendInstructions(transaction, result.instructions);
      return {
        sessionId: session.sessionId,
        participationId: result.participationId,
        heldCents: session.bookingShare.toCents(),
        refundedParticipationId: result.refundedParticipationId,
      };
    });
  }
}
