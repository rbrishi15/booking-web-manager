import { z } from "zod";

/** Request metadata used to identify retries of one logical submission. */
export interface SessionCreationSubmission {
  readonly idempotencyKey: string;
}

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
  const { booking, config, idempotencyKey } = requestSchema.parse(request);

  return {
    input: { bookerId, booking, config },
    submission: { idempotencyKey },
  };
}
