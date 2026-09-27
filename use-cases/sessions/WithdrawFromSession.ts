import { DomainError, type UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { appendInstructions, requireAggregate } from "../shared/helpers";
import { promoteWaitlist } from "./promote-waitlist";

export type WithdrawFromSessionCommand = {
  readonly actorId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
} & (
  | {
      readonly replacementMode: "OPEN_SLOT";
      readonly replacementInviteeId?: never;
    }
  | {
      readonly replacementMode: "DIRECT_INVITE";
      readonly replacementInviteeId: UUID;
    }
);

export interface WithdrawFromSessionResult {
  readonly kind: "REFUNDED" | "AWAITING_REPLACEMENT";
  readonly participationId: UUID;
}

/** UC2-05: withdraw with one fixed replacement choice and atomic financial effects. */
export class WithdrawFromSession {
  constructor(private readonly dependencies: UseCaseDependencies) {}

  execute(
    command: WithdrawFromSessionCommand,
  ): Promise<WithdrawFromSessionResult> {
    const { unitOfWork, clock, ids } = this.dependencies;
    return unitOfWork.execute(
      {
        idempotencyKey: command.idempotencyKey,
        scope: "UC2-05:withdraw",
        request: {
          actorId: command.actorId,
          sessionId: command.sessionId,
          replacementMode: command.replacementMode,
          replacementInviteeId: command.replacementInviteeId,
        },
      },
      async (transaction) => {
        const now = clock.now();
        DomainError.require(
          command.replacementMode !== undefined,
          "INVALID_INPUT",
          "A withdrawal requires a replacement choice",
        );
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
        const participation = session.participantList.findByUserId(user.userId);
        DomainError.require(
          participation !== undefined,
          "NOT_FOUND",
          "Participation was not found",
        );
        if (command.replacementMode === "DIRECT_INVITE")
          await requireAggregate(
            transaction.users,
            command.replacementInviteeId,
            "Replacement invitee",
          );

        const result = user.asParticipant().withdraw(session, {
          participationId: participation.participationId,
          now,
          replacementMode: command.replacementMode,
          replacementInviteeId: command.replacementInviteeId,
        });
        await appendInstructions(transaction, result.instructions);
        if (command.replacementMode === "OPEN_SLOT")
          await promoteWaitlist(transaction, session, ids, now);
        await transaction.sessions.save(session);

        const finalParticipation = session.participantList.requireParticipation(
          result.participationId,
        );
        return {
          kind:
            finalParticipation.hold?.state === "REFUNDED"
              ? "REFUNDED"
              : "AWAITING_REPLACEMENT",
          participationId: result.participationId,
        };
      },
    );
  }
}
