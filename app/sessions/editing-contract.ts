import { z } from "zod";
import type { SessionEditRequest, SessionEditingDetails } from "@/use-cases/sessions/EditSession";

const timestamp = z.string().datetime({ offset: true });
export const sessionEditRequestSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  booking: z.object({
    venueName: z.string().max(300).refine((value) => value.trim().length > 0),
    region: z.string().max(100).refine((value) => value.trim().length > 0),
    sport: z.string().max(100).refine((value) => value.trim().length > 0), startAt: timestamp, endAt: timestamp,
    totalCostCents: z.number().int().safe().positive(), pricePerSlotCents: z.number().int().safe().positive(),
  }),
  totalSlots: z.number().int().min(1).max(31), visibility: z.enum(["PUBLIC", "PRIVATE"]),
}) satisfies z.ZodType<SessionEditRequest>;

export const sessionEditingDetailsSchema = sessionEditRequestSchema.extend({
  sessionId: z.string().uuid(), canEdit: z.boolean(), bookingLocked: z.boolean(), minimumSlots: z.number().int().min(1).max(31),
}) satisfies z.ZodType<SessionEditingDetails>;

export type { SessionEditRequest, SessionEditingDetails };
