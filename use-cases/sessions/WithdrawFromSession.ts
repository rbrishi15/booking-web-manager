import { DomainError, type UUID, type WithdrawalResult } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { appendInstructions, requireAggregate } from "../shared/helpers";
import { type FollowUpPromotion, promoteAfter } from "./follow-up-promotion";
import type { PromoteFromWaitlist } from "./PromoteFromWaitlist";

/** Either/or at withdrawal and fixed afterwards (ADR-0006). */
export type ReplacementChoice =
  | { readonly mode: "OPEN_SLOT" }
  | { readonly mode: "DIRECT_INVITE"; readonly inviteeId: UUID };

export interface WithdrawFromSessionRequest {
  /** The authenticated participant; never taken from the request body. */
  readonly userId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
  readonly replacement: ReplacementChoice;
}

export interface WithdrawFromSessionResult {
  readonly kind: WithdrawalResult["kind"];
  readonly sessionId: UUID;
  readonly participationId: UUID;
  /** Cents returned to the wallet now; zero while awaiting a replacement. */
  readonly refundedCents: number;
  readonly promotion: FollowUpPromotion;
}

export interface WithdrawFromSessionDependencies
  extends Pick<UseCaseDependencies, "unitOfWork" | "clock"> {
  readonly promote: Pick<PromoteFromWaitlist, "forSession">;
}

/**
 * UC2-05 Withdraw from Session.
 *
 * In one unit of work, loads the participant and session and runs
 * `Participant.withdraw`. The domain applies the 30-hour rule: an early
 * withdrawal is refunded at once (a REFUND instruction written with the
 * session change); a late one keeps the share held while awaiting a
 * replacement. The participation is the caller's own, found by their user ID,
 * so a client cannot withdraw someone else.
 *
 * An open-slot withdrawal then triggers FIFO promotion in a separate unit of
 * work (see follow-up-promotion.ts). A named invitation reserves the place
 * for that person instead, who accepts through AcceptReplacement.
 */
export class WithdrawFromSession {
  constructor(private readonly dependencies: WithdrawFromSessionDependencies) {}

  async forParticipant(
    request: WithdrawFromSessionRequest,
  ): Promise<WithdrawFromSessionResult> {
    const { unitOfWork, clock, promote } = this.dependencies;
    const key = JSON.stringify([
      "UC2-05-withdraw",
      request.userId,
      request.sessionId,
      request.idempotencyKey,
    ]);

    const withdrawal = await unitOfWork.execute(key, async (transaction) => {
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
      const participation = session.participantList.findByUserId(user.userId);
      if (participation === undefined)
        throw new DomainError(
          "NOT_FOUND",
          "This user is not participating in the session",
        );
      if (request.replacement.mode === "DIRECT_INVITE")
        await requireAggregate(
          transaction.users,
          request.replacement.inviteeId,
          "Invited user",
        );

      const result = user.asParticipant().withdraw(session, {
        participationId: participation.participationId,
        now: clock.now(),
        replacementMode: request.replacement.mode,
        replacementInviteeId:
          request.replacement.mode === "DIRECT_INVITE"
            ? request.replacement.inviteeId
            : undefined,
      });

      await transaction.sessions.save(session);
      await appendInstructions(transaction, result.instructions);
      return {
        kind: result.kind,
        sessionId: session.sessionId,
        participationId: result.participationId,
        refundedCents: result.instructions
          .filter((instruction) => instruction.kind === "REFUND")
          .reduce((sum, instruction) => sum + instruction.amount.toCents(), 0),
      };
    });

    const promotion: FollowUpPromotion =
      request.replacement.mode === "OPEN_SLOT"
        ? await promoteAfter(promote, request.sessionId, key)
        : { status: "NOT_NEEDED" };
    return { ...withdrawal, promotion };
  }
}
