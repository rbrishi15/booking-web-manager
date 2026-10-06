import { DomainError, type Session, type SessionStatus, type UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";

export interface AutoVerifyAttendanceRequest {
  readonly sessionId: UUID;
  /** Identifies one scheduler run; the unit of work replays results by key. */
  readonly triggerKey: string;
}

export type AutoVerifyAttendanceResult =
  | {
      readonly outcome: "VERIFIED";
      readonly sessionId: UUID;
      /** Participations the system marked as attended in this run. */
      readonly verifiedParticipationIds: readonly UUID[];
      readonly status: SessionStatus;
    }
  /** Fewer than 72 hours have passed since the session ended. */
  | { readonly outcome: "NOT_DUE"; readonly sessionId: UUID }
  /** The session is cancelled or already past verification. */
  | { readonly outcome: "NOT_OPEN"; readonly sessionId: UUID };

/**
 * UC2-06 automatic verification, run by the scheduler.
 *
 * 72 hours after the session *ends*, `Session.autoVerifyAttendance` marks every
 * still-unverified committed participant as attended, so their shares become
 * payable to the booker. The domain owns the 72-hour rule; a run that is not
 * yet due, or finds the session no longer open, changes nothing and reports
 * why, so the sweep can safely revisit a session.
 */
export class AutoVerifyAttendance {
  constructor(
    private readonly dependencies: Pick<
      UseCaseDependencies,
      "unitOfWork" | "clock"
    >,
  ) {}

  async forSession(
    request: AutoVerifyAttendanceRequest,
  ): Promise<AutoVerifyAttendanceResult> {
    const { unitOfWork, clock } = this.dependencies;
    const key = JSON.stringify([
      "UC2-06-auto-verify",
      request.sessionId,
      request.triggerKey,
    ]);

    return unitOfWork.execute(key, async (transaction) => {
      const session = await requireAggregate(
        transaction.sessions,
        request.sessionId,
        "Session",
      );
      if (session.status !== "OPEN")
        return { outcome: "NOT_OPEN", sessionId: session.sessionId };

      const unverifiedBefore = unverifiedIds(session);
      try {
        session.autoVerifyAttendance(clock.now());
      } catch (error) {
        if (
          error instanceof DomainError &&
          error.code === "AUTO_VERIFICATION_NOT_DUE"
        )
          return { outcome: "NOT_DUE", sessionId: session.sessionId };
        throw error;
      }
      const stillUnverified = unverifiedIds(session);

      await transaction.sessions.save(session);
      return {
        outcome: "VERIFIED",
        sessionId: session.sessionId,
        verifiedParticipationIds: unverifiedBefore.filter(
          (id) => !stillUnverified.includes(id),
        ),
        status: session.status,
      };
    });
  }
}

function unverifiedIds(session: Session): UUID[] {
  return session.participantList.participations
    .filter(
      (participation) =>
        participation.status === "COMMITTED" &&
        participation.attendance === "UNVERIFIED",
    )
    .map((participation) => participation.participationId);
}
