import { z } from "zod";
import type { UUID } from "@/domain";
import type { CreateSessionRequest } from "@/use-cases/sessions/CreateSession";

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

/** Parse adapter input; the actor must come from authentication, not the body. */
export function parseCreateSessionInput(
  actorUserId: unknown,
  request: unknown,
): { actorUserId: UUID; request: CreateSessionRequest } {
  return {
    actorUserId: uuid.parse(actorUserId),
    request: requestSchema.parse(request),
  };
}
