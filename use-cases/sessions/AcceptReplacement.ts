import type { UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { appendInstructions, requireAggregate } from "../shared/helpers";
import { promoteWaitlist } from "./promote-waitlist";

export interface AcceptReplacementCommand {
  readonly actorId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
}

export interface AcceptReplacementResult {
  readonly kind: "COMMITTED";
  readonly participationId: UUID;
  readonly refundedParticipationId?: UUID;
}

/** UC2-05: the named recipient explicitly accepts their reserved place. */
export class AcceptReplacement {
  constructor(private readonly dependencies: UseCaseDependencies) {}

  execute(command: AcceptReplacementCommand): Promise<AcceptReplacementResult> {
    const { unitOfWork, clock, ids } = this.dependencies;
    return unitOfWork.execute(
      {
        idempotencyKey: command.idempotencyKey,
        scope: "UC2-05:accept-replacement",
        request: { actorId: command.actorId, sessionId: command.sessionId },
      },
      async (transaction) => {
        const now = clock.now();
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        const user = await requireAggregate(
          transaction.users,
          command.actorId,
          "User",
        );
        const existing = session.participantList.findByUserId(user.userId);
        const result = user.asParticipant().acceptReplacement(session, {
          participationId: existing?.participationId ?? ids.next(),
          holdId: ids.next(),
          now,
        });
        await appendInstructions(transaction, result.instructions);
        await promoteWaitlist(transaction, session, ids, now);
        await transaction.sessions.save(session);

        return {
          kind: "COMMITTED",
          participationId: result.participationId,
          ...(result.refundedParticipationId === undefined
            ? {}
            : { refundedParticipationId: result.refundedParticipationId }),
        };
      },
    );
  }
}
