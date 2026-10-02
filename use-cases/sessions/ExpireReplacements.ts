import type { Session, UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";
import {
  type CommitmentNotifier,
  notifyBestEffort,
} from "./commitment-notifications";

export interface ExpireReplacementsRequest {
  readonly sessionId: UUID;
  /** Identifies one sweep run; the unit of work replays results by key. */
  readonly triggerKey: string;
}

export interface ForfeitureDue {
  readonly participationId: UUID;
  readonly userId: UUID;
}

export interface ExpireReplacementsResult {
  readonly sessionId: UUID;
  /** Late withdrawals whose held share became forfeiture-due in this run. */
  readonly forfeitureDue: readonly ForfeitureDue[];
}

export interface ExpireReplacementsDependencies
  extends Pick<UseCaseDependencies, "unitOfWork" | "clock"> {
  readonly notifier: CommitmentNotifier;
}

/**
 * UC2-05 forfeiture sweep, run by the scheduler at session start.
 *
 * Calls `Session.expireReplacements`, which marks every late withdrawal still
 * awaiting a replacement once the session has started as FORFEITURE_DUE. No
 * money moves here: the held share stays in the holding account and is paid
 * to the booker as a FORFEIT line when the session's payout completes. Before
 * start this does nothing, so running the sweep early is harmless. Each
 * affected participant is notified after the unit of work commits.
 */
export class ExpireReplacements {
  constructor(private readonly dependencies: ExpireReplacementsDependencies) {}

  async forSession(
    request: ExpireReplacementsRequest,
  ): Promise<ExpireReplacementsResult> {
    const { unitOfWork, clock, notifier } = this.dependencies;
    const key = JSON.stringify([
      "UC2-05-expire-replacements",
      request.sessionId,
      request.triggerKey,
    ]);

    const result = await unitOfWork.execute(key, async (transaction) => {
      const session = await requireAggregate(
        transaction.sessions,
        request.sessionId,
        "Session",
      );
      const forfeitureDueBefore = new Set(
        forfeitureDueParticipants(session).map((entry) => entry.participationId),
      );
      session.expireReplacements(clock.now());
      const forfeitureDue = forfeitureDueParticipants(session).filter(
        (entry) => !forfeitureDueBefore.has(entry.participationId),
      );

      if (forfeitureDue.length > 0) await transaction.sessions.save(session);
      return { sessionId: session.sessionId, forfeitureDue };
    });

    await notifyBestEffort(
      notifier,
      result.forfeitureDue.map((entry) => ({
        kind: "FORFEITURE_DUE" as const,
        recipientId: entry.userId,
        sessionId: result.sessionId,
      })),
    );
    return result;
  }
}

function forfeitureDueParticipants(session: Session): ForfeitureDue[] {
  return session.participantList.participations
    .filter((participation) => participation.hold?.state === "FORFEITURE_DUE")
    .map(({ participationId, userId }) => ({ participationId, userId }));
}
