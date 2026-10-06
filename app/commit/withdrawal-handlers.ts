import type { AcceptReplacement } from "@/use-cases/sessions/AcceptReplacement";
import type { LeaveWaitlist } from "@/use-cases/sessions/LeaveWaitlist";
import type { WithdrawFromSession } from "@/use-cases/sessions/WithdrawFromSession";
import { z } from "zod";
import {
  type Authenticate,
  handleAuthenticatedJson,
  idempotencyKey,
  uuid,
} from "./http";

const sessionRequest = z.object({ sessionId: uuid, idempotencyKey });
const withdrawRequest = sessionRequest.extend({
  replacement: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("OPEN_SLOT") }),
    z.object({ mode: z.literal("DIRECT_INVITE"), inviteeId: uuid }),
  ]),
});

export interface WithdrawalHttpDependencies {
  readonly authenticate: Authenticate;
  readonly withdrawFromSession: Pick<WithdrawFromSession, "forParticipant">;
  readonly acceptReplacement: Pick<AcceptReplacement, "forInvitee">;
  readonly leaveWaitlist: Pick<LeaveWaitlist, "forParticipant">;
}

/**
 * UC2-05 withdraw: `{ sessionId, idempotencyKey, replacement }`, where
 * replacement is `{ mode: "OPEN_SLOT" }` or `{ mode: "DIRECT_INVITE",
 * inviteeId }`. The refund amount and the 30-hour rule are decided by the
 * domain inside the use case's unit of work; the body carries no amount.
 */
export function handleWithdrawFromSession(
  request: Request,
  dependencies: WithdrawalHttpDependencies,
): Promise<Response> {
  return handleAuthenticatedJson(request, {
    authenticate: dependencies.authenticate,
    parse: (userId, body) => ({ userId, ...withdrawRequest.parse(body) }),
    run: (input) => dependencies.withdrawFromSession.forParticipant(input),
    successStatus: 200,
    invalidRequestMessage: "Invalid withdrawal request",
  });
}

/**
 * UC2-05 accept a named replacement invitation: `{ sessionId,
 * idempotencyKey }`. The authenticated user's identity selects their own
 * pending invitation; the invitee's lock and the withdrawer's refund are
 * written in one unit of work.
 */
export function handleAcceptReplacement(
  request: Request,
  dependencies: WithdrawalHttpDependencies,
): Promise<Response> {
  return handleAuthenticatedJson(request, {
    authenticate: dependencies.authenticate,
    parse: (userId, body) => ({ userId, ...sessionRequest.parse(body) }),
    run: (input) => dependencies.acceptReplacement.forInvitee(input),
    successStatus: 201,
    invalidRequestMessage: "Invalid replacement acceptance request",
  });
}

/** UC2-05 leave the joining waitlist: `{ sessionId, idempotencyKey }`. */
export function handleLeaveWaitlist(
  request: Request,
  dependencies: WithdrawalHttpDependencies,
): Promise<Response> {
  return handleAuthenticatedJson(request, {
    authenticate: dependencies.authenticate,
    parse: (userId, body) => ({ userId, ...sessionRequest.parse(body) }),
    run: (input) => dependencies.leaveWaitlist.forParticipant(input),
    successStatus: 200,
    invalidRequestMessage: "Invalid waitlist departure request",
  });
}
