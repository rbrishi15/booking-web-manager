import { z } from "zod";
import { invalidRequest } from "@/app/http/request-failure";

export const removalSessionParamsSchema = z.object({ sessionId: z.string().uuid() });
export const removalParamsSchema = removalSessionParamsSchema.extend({ participationId: z.string().uuid() });
export const removalRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
});

export function parseRemovalSessionId(sessionId: unknown): string {
  const parsed = removalSessionParamsSchema.safeParse({ sessionId });
  if (!parsed.success) throw invalidRequest("Invalid session ID");
  return parsed.data.sessionId;
}

export function parseRemovalParams(sessionId: unknown, participationId: unknown) {
  const parsed = removalParamsSchema.safeParse({ sessionId, participationId });
  if (!parsed.success) throw invalidRequest("Invalid session or participation ID");
  return parsed.data;
}

export function parseRemovalInput(sessionId: unknown, participationId: unknown, body: unknown) {
  const params = parseRemovalParams(sessionId, participationId);
  const parsed = removalRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidRequest("Invalid participant removal request");
  return { ...params, ...parsed.data };
}

export async function readRemovalRequest(request: Request, sessionId: unknown, participationId: unknown) {
  let body: unknown;
  try { body = await request.json(); }
  catch (cause) {
    if (cause instanceof SyntaxError) throw invalidRequest("Request body must be valid JSON");
    throw new Error("Removal body could not be read", { cause });
  }
  return parseRemovalInput(sessionId, participationId, body);
}
