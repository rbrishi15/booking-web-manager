import type { FinancialInstruction, PromotionResult, UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { appendInstructions, requireAggregate } from "../shared/helpers";

export interface PromoteFromWaitlistRequest {
  readonly sessionId: UUID;
  /**
   * Identifies the event that may have freed a place, such as one withdrawal
   * or one scheduler run, not the session. Reusing a key replays its original
   * result, so each trigger needs its own key.
   */
  readonly triggerKey: string;
}

export interface WaitlistPromotion {
  readonly participationId: UUID;
  readonly userId: UUID;
  /** A late-withdrawing participant refunded because this entrant replaced them. */
  readonly refundedParticipationId?: UUID;
}

export interface WaitlistSkip {
  readonly participationId: UUID;
  readonly userId: UUID;
  readonly reason: NonNullable<PromotionResult["reason"]>;
}

export interface PromoteFromWaitlistResult {
  readonly sessionId: UUID;
  /** In FIFO order. */
  readonly promoted: readonly WaitlistPromotion[];
  /** Ineligible queue heads removed from the waitlist, in FIFO order. */
  readonly skipped: readonly WaitlistSkip[];
  /**
   * Set when the queue head holds a personal replacement invitation. They
   * must accept it explicitly (ADR-0006), so promotion stops without
   * skipping them or charging them automatically.
   */
  readonly awaitingInvitee?: { readonly participationId: UUID; readonly userId: UUID };
}

/**
 * Fills a session's free places from its waitlist in FIFO order (UC2-04,
 * UC2-05).
 *
 * Runs in one unit of work: while an unreserved place remains, it loads the
 * queue head's User and calls `promoteFromWaitlist` as that participant. An
 * ineligible head is skipped and the next person is tried. All promotions,
 * the refunds they trigger for late withdrawals, and the session change are
 * written together, so a failure promotes nobody.
 *
 * Callers run this after a place may have opened (an open-slot withdrawal or
 * waitlist departure) and from a scheduled sweep, which also covers a
 * trigger lost between transactions. It does nothing once the session has
 * started, closed, or has no free place.
 */
export class PromoteFromWaitlist {
  constructor(
    private readonly dependencies: Pick<
      UseCaseDependencies,
      "unitOfWork" | "clock" | "ids"
    >,
  ) {}

  async forSession(
    request: PromoteFromWaitlistRequest,
  ): Promise<PromoteFromWaitlistResult> {
    const { unitOfWork, clock, ids } = this.dependencies;
    const key = JSON.stringify([
      "promote-from-waitlist",
      request.sessionId,
      request.triggerKey,
    ]);

    return unitOfWork.execute(key, async (transaction) => {
      const session = await requireAggregate(
        transaction.sessions,
        request.sessionId,
        "Session",
      );
      const now = clock.now();
      const promoted: WaitlistPromotion[] = [];
      const skipped: WaitlistSkip[] = [];
      const instructions: FinancialInstruction[] = [];
      let awaitingInvitee: PromoteFromWaitlistResult["awaitingInvitee"];

      // getAvailableSlots(now) is zero once the session is closed or started.
      while (session.getAvailableSlots(now) > 0) {
        const head = session.participantList.nextWaitlisted();
        if (head === undefined) break;
        if (
          session.participantList.personalReplacementForInvitee(head.userId) !==
          undefined
        ) {
          awaitingInvitee = {
            participationId: head.participationId,
            userId: head.userId,
          };
          break;
        }

        const user = await requireAggregate(
          transaction.users,
          head.userId,
          "User",
        );
        const result = user
          .asParticipant()
          .promoteFromWaitlist(session, { holdId: ids.next(), now });
        instructions.push(...result.instructions);
        if (result.kind === "PROMOTED") {
          promoted.push({
            participationId: head.participationId,
            userId: head.userId,
            refundedParticipationId: result.refundedParticipationId,
          });
        } else if (result.kind === "SKIPPED" && result.reason !== undefined) {
          skipped.push({
            participationId: head.participationId,
            userId: head.userId,
            reason: result.reason,
          });
        }
      }

      if (promoted.length > 0 || skipped.length > 0) {
        await transaction.sessions.save(session);
        await appendInstructions(transaction, instructions);
      }
      return {
        sessionId: session.sessionId,
        promoted,
        skipped,
        awaitingInvitee,
      };
    });
  }
}
