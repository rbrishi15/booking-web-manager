import type { ParticipantJoinResult, UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { appendInstructions, requireAggregate } from "../shared/helpers";

/** One participant's request to take a place in a session. */
export interface CommitToSessionRequest {
  /** The authenticated participant; never taken from the request body. */
  readonly userId: UUID;
  readonly sessionId: UUID;
  /** Identifies retries of this one logical request (CLAUDE.md rule #6). */
  readonly idempotencyKey: string;
  /** Grants access to a private session when the user is not a group member. */
  readonly roomToken?: string;
}

export interface CommitToSessionResult {
  readonly kind: ParticipantJoinResult["kind"];
  readonly sessionId: UUID;
  readonly participationId: UUID;
  /** Cents moved from available to held; zero while waitlisted. */
  readonly heldCents: number;
  /** A late-withdrawing participant refunded because this entrant replaced them. */
  readonly refundedParticipationId?: UUID;
}

/**
 * UC2-04 Commit to Session.
 *
 * Loads the participant and session inside one unit of work, runs the domain's
 * admission workflow, then saves the session and appends its ledger
 * instructions in that same unit of work, so the commitment and its fund lock
 * succeed or fail together (CLAUDE.md rule #5). The domain decides between
 * committing and waitlisting, the booking share, access and eligibility.
 *
 * Retrying with the same idempotency key replays the original result without
 * locking funds again. A failed attempt stores no result and may be retried.
 */
export class CommitToSession {
  constructor(
    private readonly dependencies: Pick<
      UseCaseDependencies,
      "unitOfWork" | "clock" | "ids"
    >,
  ) {}

  async forParticipant(
    request: CommitToSessionRequest,
  ): Promise<CommitToSessionResult> {
    const { unitOfWork, clock, ids } = this.dependencies;
    const key = JSON.stringify([
      "UC2-04",
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
      // Re-entering the waitlist after leaving it must reuse the old record.
      const existing = session.participantList.findByUserId(user.userId);

      const result = user.asParticipant().join(session, {
        participationId: existing?.participationId ?? ids.next(),
        holdId: ids.next(),
        now: clock.now(),
        roomToken: request.roomToken,
      });

      await transaction.sessions.save(session);
      await appendInstructions(transaction, result.instructions);
      return {
        kind: result.kind,
        sessionId: session.sessionId,
        participationId: result.participationId,
        heldCents: result.kind === "COMMITTED" ? session.bookingShare.toCents() : 0,
        refundedParticipationId: result.refundedParticipationId,
      };
    });
  }
}
