import { DomainError, type UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";
import { type FollowUpPromotion, promoteAfter } from "./follow-up-promotion";
import type { PromoteFromWaitlist } from "./PromoteFromWaitlist";

export interface LeaveWaitlistRequest {
  /** The authenticated participant; never taken from the request body. */
  readonly userId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
}

export interface LeaveWaitlistResult {
  readonly sessionId: UUID;
  readonly participationId: UUID;
  readonly promotion: FollowUpPromotion;
}

export interface LeaveWaitlistDependencies
  extends Pick<UseCaseDependencies, "unitOfWork" | "clock"> {
  readonly promote: Pick<PromoteFromWaitlist, "forSession">;
}

/**
 * UC2-05 for a waiting participant: leave the joining waitlist. No funds are
 * held while waitlisted, so no ledger instruction is written.
 *
 * Departure can unblock the queue (for example, when the departing head held
 * an unaccepted invitation), so it triggers FIFO promotion afterwards.
 */
export class LeaveWaitlist {
  constructor(private readonly dependencies: LeaveWaitlistDependencies) {}

  async forParticipant(
    request: LeaveWaitlistRequest,
  ): Promise<LeaveWaitlistResult> {
    const { unitOfWork, clock, promote } = this.dependencies;
    const key = JSON.stringify([
      "UC2-05-leave-waitlist",
      request.userId,
      request.sessionId,
      request.idempotencyKey,
    ]);

    const departure = await unitOfWork.execute(key, async (transaction) => {
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
          "This user is not on the session's waitlist",
        );

      user.asParticipant().leaveWaitlist(session, {
        participationId: participation.participationId,
        now: clock.now(),
      });

      await transaction.sessions.save(session);
      return {
        sessionId: session.sessionId,
        participationId: participation.participationId,
      };
    });

    const promotion = await promoteAfter(promote, request.sessionId, key);
    return { ...departure, promotion };
  }
}
