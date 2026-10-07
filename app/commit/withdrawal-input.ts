import type { UUID } from "@/domain";
import type { AcceptReplacementRequest } from "@/use-cases/sessions/AcceptReplacement";
import type { LeaveWaitlistRequest } from "@/use-cases/sessions/LeaveWaitlist";
import type { WithdrawFromSessionRequest } from "@/use-cases/sessions/WithdrawFromSession";
import { z } from "zod";
import { idempotencyKey, uuid } from "./http";

const sessionRequest = z.object({ sessionId: uuid, idempotencyKey });
const withdrawRequest = sessionRequest.extend({
  replacement: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("OPEN_SLOT") }),
    z.object({ mode: z.literal("DIRECT_INVITE"), inviteeId: uuid }),
  ]),
});

/**
 * UC2-05 withdraw: `{ sessionId, idempotencyKey, replacement }`, where
 * replacement is `{ mode: "OPEN_SLOT" }` or `{ mode: "DIRECT_INVITE",
 * inviteeId }`. The refund amount and the 30-hour rule are decided by the
 * domain inside the use case's unit of work; the body carries no amount.
 */
export function parseWithdrawInput(
  userId: UUID,
  body: unknown,
): WithdrawFromSessionRequest {
  return { userId, ...withdrawRequest.parse(body) };
}

/**
 * UC2-05 accept a named replacement invitation or leave the waitlist:
 * `{ sessionId, idempotencyKey }`. The authenticated user selects their own
 * invitation or waitlist entry.
 */
export function parseSessionActionInput(
  userId: UUID,
  body: unknown,
): AcceptReplacementRequest & LeaveWaitlistRequest {
  return { userId, ...sessionRequest.parse(body) };
}
