import { z } from "zod";
import { invalidRequest } from "@/app/http/request-failure";

export const sessionVisibilityRequestSchema = z.object({ visibility: z.enum(["PUBLIC", "PRIVATE"]) });
export const sessionVisibilityParamsSchema = z.object({ sessionId: z.string().uuid() });

export function parseSessionVisibilityInput(sessionId: unknown, body: unknown) {
  const params = sessionVisibilityParamsSchema.safeParse({ sessionId });
  const input = sessionVisibilityRequestSchema.safeParse(body);
  if (!params.success || !input.success) throw invalidRequest("Invalid session visibility request");
  return { sessionId: params.data.sessionId, visibility: input.data.visibility };
}

export async function readSessionVisibilityRequest(request: Request, sessionId: unknown) {
  let body: unknown;
  try {
    body = await request.json();
  } catch (cause) {
    if (cause instanceof SyntaxError) throw invalidRequest("Request body must be valid JSON");
    throw new Error("Session visibility request could not be read", { cause });
  }
  return parseSessionVisibilityInput(sessionId, body);
}
