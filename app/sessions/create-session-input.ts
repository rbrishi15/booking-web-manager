import { z } from "zod";
import type { UUID } from "@/domain";
import { invalidRequest } from "@/app/http/request-failure";
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
    pricePerSlotCents: z.number().int().safe().positive().optional(),
    totalSlots: z.number().finite(),
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

/** Classifies client transport failures after the caller has verified the booker. */
export async function readCreateSessionRequest(
  request: Request,
  bookerId: UUID,
): Promise<ReturnType<typeof parseCreateSessionInput>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    if (cause instanceof SyntaxError)
      throw invalidRequest("Request body must be valid JSON");
    throw new Error("Session request body could not be read", { cause });
  }

  try {
    return parseCreateSessionInput(bookerId, body);
  } catch (cause) {
    if (cause instanceof z.ZodError)
      throw invalidRequest("Invalid session creation request");
    throw new Error("Session creation request could not be parsed", { cause });
  }
}
