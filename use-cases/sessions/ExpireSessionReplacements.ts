import { DomainError, type UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";

export interface ExpireSessionReplacementsCommand {
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
}

export interface ExpireSessionReplacementsResult {
  readonly expiredParticipationIds: readonly UUID[];
}

/** UC2-05: mark unreplaced late withdrawals due for forfeiture at session start. */
export class ExpireSessionReplacements {
  constructor(private readonly dependencies: UseCaseDependencies) {}

  execute(
    command: ExpireSessionReplacementsCommand,
  ): Promise<ExpireSessionReplacementsResult> {
    const { unitOfWork, clock } = this.dependencies;
    return unitOfWork.execute(
      {
        idempotencyKey: command.idempotencyKey,
        scope: "UC2-05:expire-replacements",
        request: { sessionId: command.sessionId },
      },
      async (transaction) => {
        const now = clock.now();
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        DomainError.require(
          session.booking.hasStarted(now),
          "INVALID_STATE",
          "Replacement expiry is not due before the session starts",
        );
        const awaitingReplacementIds = session.participantList.participations
          .filter(
            (participation) =>
              participation.status === "WITHDRAWN" &&
              participation.hold?.state === "AWAITING_REPLACEMENT",
          )
          .map((participation) => participation.participationId);

        session.expireReplacements(now);
        await transaction.sessions.save(session);

        return {
          expiredParticipationIds: awaitingReplacementIds.filter(
            (participationId) =>
              session.participantList.requireParticipation(participationId).hold
                ?.state === "FORFEITURE_DUE",
          ),
        };
      },
    );
  }
}
