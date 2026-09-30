import type { Session, UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";

export interface ExpireReplacementsRequest {
  readonly sessionId: UUID;
  /** Identifies one sweep run; the unit of work replays results by key. */
  readonly triggerKey: string;
}

export interface ExpireReplacementsResult {
  readonly sessionId: UUID;
  /** Late withdrawals whose held share became forfeiture-due in this run. */
  readonly forfeitureDue: readonly UUID[];
}

/**
 * UC2-05 forfeiture sweep, run by the scheduler at session start.
 *
 * Calls `Session.expireReplacements`, which marks every late withdrawal still
 * awaiting a replacement once the session has started as FORFEITURE_DUE. No
 * money moves here: the held share stays in the holding account and is paid
 * to the booker as a FORFEIT line when the session's payout completes. Before
 * start this does nothing, so running the sweep early is harmless.
 */
export class ExpireReplacements {
  constructor(
    private readonly dependencies: Pick<
      UseCaseDependencies,
      "unitOfWork" | "clock"
    >,
  ) {}

  async forSession(
    request: ExpireReplacementsRequest,
  ): Promise<ExpireReplacementsResult> {
    const { unitOfWork, clock } = this.dependencies;
    const key = JSON.stringify([
      "UC2-05-expire-replacements",
      request.sessionId,
      request.triggerKey,
    ]);

    return unitOfWork.execute(key, async (transaction) => {
      const session = await requireAggregate(
        transaction.sessions,
        request.sessionId,
        "Session",
      );
      const forfeitureDueBefore = forfeitureDueIds(session);
      session.expireReplacements(clock.now());
      const forfeitureDue = forfeitureDueIds(session).filter(
        (id) => !forfeitureDueBefore.includes(id),
      );

      if (forfeitureDue.length > 0) await transaction.sessions.save(session);
      return { sessionId: session.sessionId, forfeitureDue };
    });
  }
}

function forfeitureDueIds(session: Session): UUID[] {
  return session.participantList.participations
    .filter((participation) => participation.hold?.state === "FORFEITURE_DUE")
    .map((participation) => participation.participationId);
}
