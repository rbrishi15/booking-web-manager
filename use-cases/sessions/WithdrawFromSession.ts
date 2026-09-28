import { DomainError, type UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { appendInstructions, requireAggregate } from "../shared/helpers";
import { promoteWaitlist } from "./promote-waitlist";

export interface WithdrawFromSessionRequest {
  readonly actorId: UUID;
  readonly sessionId: UUID;
  readonly idempotencyKey: string;
}

type WithdrawalChoice =
  | {
      readonly replacementMode: "OPEN_SLOT";
      readonly replacementInviteeId?: never;
    }
  | {
      readonly replacementMode: "DIRECT_INVITE";
      readonly replacementInviteeId: UUID;
    };

export interface WithdrawFromSessionResult {
  readonly kind: "REFUNDED" | "AWAITING_REPLACEMENT";
  readonly participationId: UUID;
}

/** UC2-05: withdraw with one fixed replacement choice and atomic financial effects. */
export class WithdrawFromSession {
  constructor(private readonly dependencies: UseCaseDependencies) {}

  withdrawAndInvite(
    replacementInviteeId: UUID,
    request: WithdrawFromSessionRequest,
  ): Promise<WithdrawFromSessionResult> {
    return this.withdraw(request, {
      replacementMode: "DIRECT_INVITE",
      replacementInviteeId,
    });
  }

  withdrawAndOpenToWaitlist(
    request: WithdrawFromSessionRequest,
  ): Promise<WithdrawFromSessionResult> {
    return this.withdraw(request, { replacementMode: "OPEN_SLOT" });
  }

  private withdraw(
    request: WithdrawFromSessionRequest,
    choice: WithdrawalChoice,
  ): Promise<WithdrawFromSessionResult> {
    const { unitOfWork, clock, ids } = this.dependencies;
    return unitOfWork.execute(
      {
        idempotencyKey: request.idempotencyKey,
        scope: "UC2-05:withdraw",
        request: {
          actorId: request.actorId,
          sessionId: request.sessionId,
          replacementMode: choice.replacementMode,
          replacementInviteeId: choice.replacementInviteeId,
        },
      },
      async (transaction) => {
        const now = clock.now();
        const session = await requireAggregate(
          transaction.sessions,
          request.sessionId,
          "Session",
        );
        const user = await requireAggregate(
          transaction.users,
          request.actorId,
          "User",
        );
        const participation = session.participantList.findByUserId(user.userId);
        DomainError.require(
          participation !== undefined,
          "NOT_FOUND",
          "Participation was not found",
        );
        if (choice.replacementMode === "DIRECT_INVITE")
          await requireAggregate(
            transaction.users,
            choice.replacementInviteeId,
            "Replacement invitee",
          );

        const result = user.asParticipant().withdraw(session, {
          participationId: participation.participationId,
          now,
          replacementMode: choice.replacementMode,
          replacementInviteeId: choice.replacementInviteeId,
        });
        await appendInstructions(transaction, result.instructions);
        if (choice.replacementMode === "OPEN_SLOT")
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
