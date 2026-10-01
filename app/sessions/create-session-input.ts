import { z } from "zod";
import type { SessionCreationSubmission } from "@/lib/sessions/request-session-creation-transaction";

const uuid = z.string().uuid();
const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(new Date(value).getTime()), {
    message: "Invalid date",
  });

/** JSON transport contract, also used to generate the OpenAPI request schema. */
export const createSessionRequestSchema = z.object({
  idempotencyKey: z
    .string()
    .max(200, { message: "The idempotency key is too long" })
    .regex(/\S/, { message: "An idempotency key is required" }),
  booking: z.object({
    venueName: z.string(),
    region: z.string(),
    sport: z.string(),
    startAt: timestamp,
    endAt: timestamp,
    totalCostCents: z.number().int().safe(),
  }),
  config: z.object({
    totalSlots: z.number().finite(),
    minimumHeadcount: z.number().finite(),
    visibility: z.enum(["PRIVATE", "PUBLIC"]).optional(),
    minimumReliability: z.number().finite().optional(),
    invitedGroupId: uuid.optional(),
  }),
});

/** Parse business input separately from submission metadata and trusted identity. */
export function parseCreateSessionInput(
  actorUserId: unknown,
  request: unknown,
) {
  const bookerId = uuid.parse(actorUserId);
  const { booking, config, idempotencyKey } = createSessionRequestSchema.parse(request);
  const submission: SessionCreationSubmission = { idempotencyKey };

  return {
    input: {
      bookerId,
      booking: {
        ...booking,
        startAt: new Date(booking.startAt),
        endAt: new Date(booking.endAt),
      },
      config,
    },
    submission,
  };
}
