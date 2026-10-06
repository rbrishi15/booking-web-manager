import { z } from "zod";
import { invalidRequest } from "@/app/http/request-failure";

export const withdrawalPreviewParamsSchema = z.object({ sessionId: z.string().uuid() });

export function parseWithdrawalPreviewSessionId(sessionId: unknown): string {
  const parsed = withdrawalPreviewParamsSchema.safeParse({ sessionId });
  if (!parsed.success) throw invalidRequest("Invalid session ID");
  return parsed.data.sessionId;
}
