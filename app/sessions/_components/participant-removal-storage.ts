import { z } from "zod";

const pendingRemovalSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().uuid(),
  participationId: z.string().uuid(),
  displayName: z.string(),
  idempotencyKey: z.string().uuid(),
  previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
  refundCents: z.number().int().nonnegative().safe(),
});

export type PendingParticipantRemoval = z.infer<typeof pendingRemovalSchema>;

/** A confirmed request belongs to one authenticated host and one session. */
export function participantRemovalStorageKey(userId: string, sessionId: string): string {
  return `participant-removal:${userId}:${sessionId}`;
}

/** Never discard an unreadable request: its financial outcome may still be unknown. */
export function readPendingParticipantRemoval(value: string, userId: string, sessionId: string): PendingParticipantRemoval | null {
  try {
    const parsed = pendingRemovalSchema.safeParse(JSON.parse(value));
    return parsed.success && parsed.data.userId === userId && parsed.data.sessionId === sessionId ? parsed.data : null;
  } catch {
    return null;
  }
}
