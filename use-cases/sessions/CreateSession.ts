import { z } from "zod";
import { Booking, Money, ReliabilityScore, type UUID } from "@/domain";
import type { UseCaseDependencies } from "../shared/dependencies";
import { requireAggregate } from "../shared/helpers";

const uuid = z.string().uuid();
const requestSchema = z.object({
  idempotencyKey: z.string().refine((key) => key.trim() !== "", {
    message: "An idempotency key is required",
  }),
  booking: z.object({
    venueName: z.string(),
    region: z.string(),
    sport: z.string(),
    startAt: z.date(),
    endAt: z.date(),
    totalCostCents: z.number().int().safe(),
  }),
  totalSlots: z.number().finite(),
  minimumHeadcount: z.number().finite(),
  visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
  minimumReliability: z.number().finite().optional(),
  invitedGroupId: uuid.optional(),
});

export type CreateSessionRequest = z.input<typeof requestSchema>;

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
  constructor(private readonly dependencies: CreateSessionDependencies) {
    uuid.parse(dependencies.holdingAccountId);
  }

  /**
   * actorUserId must come from authentication, independently of the request.
   * A repeated actor/key returns the original creation result; use a new key
   * for a new session. The transaction adapter owns rollback and replay storage.
   */
  async execute(
    actorUserId: UUID,
    request: CreateSessionRequest,
  ): Promise<CreateSessionResult> {
    const userId = uuid.parse(actorUserId);
    const input = requestSchema.parse(request);
    const { unitOfWork, clock, ids, holdingAccountId } = this.dependencies;
    const key = JSON.stringify(["UC2-02", userId, input.idempotencyKey]);

    return unitOfWork.execute(key, async (transaction) => {
      const user = await requireAggregate(transaction.users, userId, "User");
      const booking = new Booking({
        venueName: input.booking.venueName,
        region: input.booking.region,
        sport: input.booking.sport,
        startAt: input.booking.startAt,
        endAt: input.booking.endAt,
        totalCost: Money.fromCents(input.booking.totalCostCents),
      });
      const session = user.asBooker().createSession({
        sessionId: uuid.parse(ids.next()),
        roomToken: uuid.parse(ids.next()),
        holdingAccountId,
        booking,
        totalSlots: input.totalSlots,
        minimumHeadcount: input.minimumHeadcount,
        visibility: input.visibility,
        minimumReliability:
          input.minimumReliability === undefined
            ? undefined
            : ReliabilityScore.from(input.minimumReliability),
        invitedGroupId: input.invitedGroupId,
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
