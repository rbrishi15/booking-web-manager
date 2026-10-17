import { z } from "zod";
import type { UUID } from "@/domain";
import { invalidRequest } from "@/app/http/request-failure";
import type { WithdrawSessionPayoutRequest } from "@/use-cases/payouts/WithdrawSessionPayout";

export const withdrawRequestSchema = z.object({
  sessionId: z.string().uuid(),
  /** One key per withdrawal attempt; retry with the same key after an unclear failure. */
  idempotencyKey: z.string().trim().min(1).max(200),
  /** INSTANT pays an eligible debit card at once and falls back to STANDARD. */
  method: z.enum(["STANDARD", "INSTANT"]).default("STANDARD"),
});

/** UC1-08: the booker comes from authentication, never the body; the server computes the amount. */
export function parseWithdrawInput(bookerId: UUID, body: unknown): WithdrawSessionPayoutRequest {
  const parsed = withdrawRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidRequest(parsed.error.issues[0]?.message ?? "Invalid withdrawal request");
  return { bookerId, ...parsed.data };
}

/** Reads the JSON body, answering 400 for a body that is not JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (cause) {
    if (cause instanceof SyntaxError) throw invalidRequest("Request body must be valid JSON");
    throw new Error("Request body could not be read", { cause });
  }
}
