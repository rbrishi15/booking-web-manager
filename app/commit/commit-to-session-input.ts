import type { CommitToSessionRequest } from "@/use-cases/sessions/CommitToSession";
import { z } from "zod";

const uuid = z.string().uuid();
const requestSchema = z.object({
  sessionId: uuid,
  idempotencyKey: z.string().refine((key) => key.trim() !== "", {
    message: "An idempotency key is required",
  }),
  roomToken: z.string().min(1).optional(),
});

/**
 * UC2-04 request body: `{ sessionId, idempotencyKey, roomToken? }`.
 * The participant comes from authentication, never from the body. Unknown
 * fields such as a client-supplied amount or user ID are stripped; the share
 * is always derived server-side from the stored session.
 */
export function parseCommitToSessionInput(
  actorUserId: unknown,
  body: unknown,
): CommitToSessionRequest {
  const userId = uuid.parse(actorUserId);
  const { sessionId, idempotencyKey, roomToken } = requestSchema.parse(body);
  return { userId, sessionId, idempotencyKey, roomToken };
}
