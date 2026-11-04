import { z } from "zod";

const identities = { sessionId: z.string().uuid(), participationId: z.string().uuid() };
export const participantRemovalPreviewSchema = z.object({
  ...identities, refundCents: z.number().int().nonnegative(), previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
});
export const participantRemovalResultSchema = z.object({
  ...identities, status: z.literal("REMOVED"), refundCents: z.number().int().nonnegative(),
});
export const sessionParticipantsSchema = z.object({
  sessionId: z.string().uuid(), venueName: z.string(), sport: z.string(),
  startAt: z.string().datetime(), endAt: z.string().datetime(),
  status: z.enum(["OPEN", "CANCELLED", "AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"]),
  availableSlots: z.number().int().nonnegative(), totalSlots: z.number().int().nonnegative(),
  booker: z.object({ displayName: z.string(), participationId: z.string().uuid().optional() }),
  canVerifyAttendance: z.boolean(),
  participants: z.array(z.object({
    participationId: z.string().uuid(), displayName: z.string(),
    status: z.enum(["WAITLISTED", "COMMITTED", "LEFT_WAITLIST", "WITHDRAWN", "REMOVED", "CANCELLED"]),
    attendance: z.enum(["UNVERIFIED", "ATTENDED", "ABSENT"]), canRemove: z.boolean(),
  })),
});
