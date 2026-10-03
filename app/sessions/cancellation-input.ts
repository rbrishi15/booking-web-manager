import { z } from "zod";
import { invalidRequest } from "@/app/http/request-failure";

export const cancellationParamsSchema = z.object({ sessionId: z.string().uuid() });
export const cancellationRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
});

export function parseCancellationSessionId(sessionId: unknown): string {
  const parsed = cancellationParamsSchema.safeParse({ sessionId });
  if (!parsed.success) throw invalidRequest("Invalid session ID");
  return parsed.data.sessionId;
}

export function parseCancellationInput(sessionId: unknown, body: unknown) {
  const id = parseCancellationSessionId(sessionId);
  const parsed = cancellationRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidRequest("Invalid session cancellation request");
  return { sessionId: id, ...parsed.data };
}

export async function readCancellationRequest(request: Request, sessionId: unknown) {
  let body: unknown;
  try { body = await request.json(); }
  catch (cause) {
    if (cause instanceof SyntaxError) throw invalidRequest("Request body must be valid JSON");
    throw new Error("Cancellation body could not be read", { cause });
  }
  return parseCancellationInput(sessionId, body);
}
