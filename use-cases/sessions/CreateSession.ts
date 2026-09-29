import {
  Booking,
  Money,
  ReliabilityScore,
  type Region,
  type Sport,
  type UUID,
  type Visibility,
} from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";

/** Validated application input; transport parsing belongs to the caller. */
export interface CreateSessionRequest {
  idempotencyKey: string;
  booking: {
    venueName: string;
    region: Region;
    sport: Sport;
    startAt: Date;
    endAt: Date;
    totalCostCents: number;
  };
  totalSlots: number;
  minimumHeadcount: number;
  visibility?: Visibility;
  minimumReliability?: number;
  invitedGroupId?: UUID;
}

export interface CreateSessionResult {
  readonly sessionId: UUID;
  readonly roomToken: string;
  readonly bookingShareCents: number;
}

export interface CreateSessionDependencies extends UseCaseDependencies {
  /** The existing platform holding account, supplied by server configuration. */
  readonly holdingAccountId: UUID;
}

/** UC2-02: load the booker, apply domain creation rules, and save atomically. */
export class CreateSession {
  constructor(private readonly dependencies: CreateSessionDependencies) {}

  /**
   * The caller validates the DTO and supplies actorUserId from authentication,
   * independently of the request. Domain rules are checked during creation.
   * A repeated actor/key returns the original creation result; use a new key
   * for a new session. The transaction adapter owns rollback and replay storage.
   */
  async execute(
    actorUserId: UUID,
    request: CreateSessionRequest,
  ): Promise<CreateSessionResult> {
    const { unitOfWork, clock, ids, holdingAccountId } = this.dependencies;
    const key = JSON.stringify(["UC2-02", actorUserId, request.idempotencyKey]);

    return unitOfWork.execute(key, async (transaction) => {
      const user = await requireAggregate(transaction.users, actorUserId, "User");
      const booking = new Booking({
        venueName: request.booking.venueName,
        region: request.booking.region,
        sport: request.booking.sport,
        startAt: request.booking.startAt,
        endAt: request.booking.endAt,
        totalCost: Money.fromCents(request.booking.totalCostCents),
      });
      const session = user.asBooker().createSession({
        sessionId: ids.next(),
        roomToken: ids.next(),
        holdingAccountId,
        booking,
        totalSlots: request.totalSlots,
        minimumHeadcount: request.minimumHeadcount,
        visibility: request.visibility,
        minimumReliability:
          request.minimumReliability === undefined
            ? undefined
            : ReliabilityScore.from(request.minimumReliability),
        invitedGroupId: request.invitedGroupId,
        now: clock.now(),
      });

      await transaction.sessions.save(session);
      return {
        sessionId: session.sessionId,
        roomToken: session.roomToken,
        bookingShareCents: session.bookingShare.toCents(),
      };
    });
  }
}
