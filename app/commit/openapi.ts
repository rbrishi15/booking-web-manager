import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { errorResponse, z } from "@/app/openapi/contracts";
import { joinedSessionsResponseSchema } from "./joined-sessions-contract";

// Documentation schemas mirror the existing handler contracts without changing them.
const uuid = z.string().uuid();
const idempotencyKey = z.string().regex(/\S/);
const sessionRequestSchema = z.object({ sessionId: uuid, idempotencyKey });
const commitToSessionRequestSchema = sessionRequestSchema.extend({
  roomToken: z.string().min(1).optional(),
});
const withdrawFromSessionRequestSchema = sessionRequestSchema.extend({
  replacement: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("OPEN_SLOT") }),
    z.object({ mode: z.literal("DIRECT_INVITE"), inviteeId: uuid }),
  ]),
});
const verifyAttendanceRequestSchema = sessionRequestSchema.extend({
  marks: z.array(z.object({
    participationId: uuid,
    attendance: z.enum(["ATTENDED", "ABSENT"]),
  })).min(1),
});

const sessionId = "11111111-1111-4111-8111-111111111111";
const participationId = "22222222-2222-4222-8222-222222222222";
const inviteeId = "33333333-3333-4333-8333-333333333333";

/** Describe the commitment action routes and the scheduler endpoint. */
export function registerCommitmentApi(registry: OpenAPIRegistry): void {
  const uuid = z.string().uuid();
  const cents = z.number().int().safe().nonnegative();
  const promotionResult = registry.register("WaitlistPromotionResult", z.object({
    sessionId: uuid,
    promoted: z.array(z.object({
      participationId: uuid,
      userId: uuid,
      refundedParticipationId: uuid.optional(),
    })),
    skipped: z.array(z.object({
      participationId: uuid,
      userId: uuid,
      reason: z.enum(["INACTIVE_ACCOUNT", "LOW_RELIABILITY", "INSUFFICIENT_FUNDS"]),
    })),
    awaitingInvitee: z.object({ participationId: uuid, userId: uuid }).optional(),
  }));
  const promotion = registry.register("FollowUpPromotion", z.discriminatedUnion("status", [
    z.object({ status: z.literal("NOT_NEEDED") }),
    z.object({ status: z.literal("COMPLETED"), result: promotionResult }),
    z.object({ status: z.literal("DEFERRED") }),
  ]));
  const commitResult = registry.register("CommitToSessionResult", z.object({
    kind: z.enum(["COMMITTED", "WAITLISTED"]),
    sessionId: uuid,
    participationId: uuid,
    heldCents: cents,
    refundedParticipationId: uuid.optional(),
  }));
  const withdrawalResult = registry.register("WithdrawFromSessionResult", z.object({
    kind: z.enum(["REFUNDED", "AWAITING_REPLACEMENT"]),
    sessionId: uuid,
    participationId: uuid,
    refundedCents: cents,
    promotion,
  }));
  const replacementResult = registry.register("AcceptReplacementResult", z.object({
    sessionId: uuid,
    participationId: uuid,
    heldCents: cents,
    refundedParticipationId: uuid.optional(),
  }));
  const leaveResult = registry.register("LeaveWaitlistResult", z.object({
    sessionId: uuid,
    participationId: uuid,
    promotion,
  }));
  const verifyResult = registry.register("VerifyAttendanceResult", z.object({
    sessionId: uuid,
    status: z.enum(["OPEN", "CANCELLED", "AWAITING_PAYOUT", "PAYOUT_PENDING", "SETTLED"]),
  }));

  const operations = [
    {
      path: "/api/sessions/commit", operationId: "commitToSession",
      summary: "UC2-04 Commit to Session", status: 201,
      requestName: "CommitToSessionRequest", request: commitToSessionRequestSchema,
      result: commitResult, invalidMessage: "Invalid commitment request",
      example: { sessionId, idempotencyKey: "commit-my-place", roomToken: "private-room-token" },
      description: "Takes a place, or joins the FIFO waitlist when no ordinary place is available. " +
        "The stored session determines the booking share in integer cents; waitlisting holds zero cents. " +
        "A roomToken can grant private-session access. Commitment and its fund lock are atomic.",
    },
    {
      path: "/api/sessions/withdraw", operationId: "withdrawFromSession",
      summary: "UC2-05 Withdraw from Session", status: 200,
      requestName: "WithdrawFromSessionRequest", request: withdrawFromSessionRequestSchema,
      result: withdrawalResult, invalidMessage: "Invalid withdrawal request",
      example: { sessionId, idempotencyKey: "withdraw-my-place", replacement: { mode: "DIRECT_INVITE", inviteeId } },
      description: "Withdraws the authenticated participant's own place. Choose OPEN_SLOT or DIRECT_INVITE " +
        "for one existing named invitee; the choice cannot change after withdrawal. More than 30 hours " +
        "before start refunds immediately; exactly 30 hours or less retains the held share awaiting replacement. " +
        "Open-slot withdrawal triggers promotion after commit. DEFERRED promotion keeps the withdrawal committed.",
    },
    {
      path: "/api/sessions/replacements/accept", operationId: "acceptReplacement",
      summary: "UC2-05 Accept Replacement", status: 201,
      requestName: "AcceptReplacementRequest", request: sessionRequestSchema,
      result: replacementResult, invalidMessage: "Invalid replacement acceptance request",
      example: { sessionId, idempotencyKey: "accept-my-invitation" },
      description: "The authenticated named invitee explicitly accepts their reserved place. " +
        "Their full booking share is held and any eligible late withdrawal is refunded in the same transaction.",
    },
    {
      path: "/api/sessions/waitlist/leave", operationId: "leaveWaitlist",
      summary: "UC2-05 Leave Waitlist", status: 200,
      requestName: "LeaveWaitlistRequest", request: sessionRequestSchema,
      result: leaveResult, invalidMessage: "Invalid waitlist departure request",
      example: { sessionId, idempotencyKey: "leave-my-queue-entry" },
      description: "Removes the authenticated participant's own waitlist entry without moving money. " +
        "Follow-up promotion runs after commit; DEFERRED means the scheduler should retry it.",
    },
    {
      path: "/api/sessions/attendance", operationId: "verifyAttendance",
      summary: "UC2-06 Verify Attendance", status: 200,
      requestName: "VerifyAttendanceRequest", request: verifyAttendanceRequestSchema,
      result: verifyResult, invalidMessage: "Invalid attendance verification request",
      example: { sessionId, idempotencyKey: "mark-session-attendance", marks: [{ participationId, attendance: "ATTENDED" }] },
      description: "Only the session's booker can mark attendance after the session ends. " +
        "All committed participants verified changes the session to AWAITING_PAYOUT; verification itself moves no money.",
    },
  ];
  for (const operation of operations) {
    const request = registry.register(operation.requestName, operation.request);
    registry.registerPath({
      method: "post",
      path: operation.path,
      operationId: operation.operationId,
      tags: ["Commitment"],
      summary: operation.summary,
      description: [
        operation.description,
        "The actor comes from the verified Supabase bearer token; the stored account then enforces status, email verification and reliability. Client-supplied user IDs and amounts are ignored.",
        "A nonblank idempotencyKey is required. A retry with the same actor, session and action key replays the original transaction result.",
        "Notifications emitted by the action are best-effort after commit and may repeat on retry. Unknown JSON fields are ignored.",
      ].join(" "),
      security: [{ bearerAuth: [] }],
      request: { body: { required: true, content: {
        "application/json": { schema: request, example: operation.example },
      } } },
      responses: {
        [operation.status]: { description: "The action completed, or its successful transaction result replayed.",
          content: { "application/json": { schema: operation.result } } },
        400: errorResponse("Malformed JSON or structurally invalid input.", "INVALID_REQUEST", operation.invalidMessage),
        401: errorResponse("Missing, invalid or expired Supabase bearer token.", "UNAUTHENTICATED", "Authentication is required"),
        403: errorResponse("Domain rejects an unauthorized actor, inactive or unverified account, invalid private access or insufficient reliability.", "UNAUTHORIZED", "This action is not authorized"),
        404: errorResponse("The user, session, participation or invited user does not exist.", "NOT_FOUND", "Session was not found"),
        409: errorResponse("Invalid session/participation/invitation state, insufficient funds, conflicting attendance or invalid timing.", "INVALID_STATE", "The action conflicts with the current session state"),
        422: errorResponse("Structurally valid input violates domain rules.", "INVALID_INPUT", "Invalid session action"),
        500: errorResponse("Unexpected authentication, setup or persistence failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
        503: errorResponse("Session management server settings are not configured.", "SESSION_MANAGEMENT_UNAVAILABLE", "Session management is not available yet"),
      },
    });
  }

  const joined = registry.register("JoinedSessions", joinedSessionsResponseSchema);
  registry.registerPath({
    method: "get",
    path: "/api/sessions/joined",
    operationId: "listJoinedSessions",
    tags: ["Commitment"],
    summary: "UC2-05 List the sessions you have joined",
    description: "Requires an active authenticated account. Returns the caller's COMMITTED and WAITLISTED places in OPEN sessions that have not started, in start order. " +
      "A COMMITTED place can be withdrawn (preview the refund with GET /api/sessions/{sessionId}/withdrawal-preview, then POST /api/sessions/withdraw); a WAITLISTED place can be left with POST /api/sessions/waitlist/leave. " +
      "Read-only; no money moves. The caller comes from the verified Supabase bearer token.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: { description: "The caller's joined and waitlisted sessions.", content: { "application/json": { schema: joined, example: {
        sessions: [{ sessionId, venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central",
          startAt: "2045-04-02T10:00:00.000Z", endAt: "2045-04-02T12:00:00.000Z", status: "COMMITTED", bookingShareCents: 1250 }],
      } } } },
      401: errorResponse("Missing, invalid or expired Supabase bearer token.", "UNAUTHENTICATED", "Authentication is required"),
      403: errorResponse("The account is inactive.", "INACTIVE_ACCOUNT", "An inactive account cannot manage its sessions"),
      404: errorResponse("The authenticated user has no account.", "NOT_FOUND", "User was not found"),
      500: errorResponse("Unexpected authentication, setup or persistence failure; internal details are redacted.", "INTERNAL_ERROR", "Internal server error"),
      503: errorResponse("Session management server settings are not configured.", "SESSION_MANAGEMENT_UNAVAILABLE", "Session management is not available yet"),
    },
  });

  registry.registerComponent("securitySchemes", "cronAuth", {
    type: "http", scheme: "bearer",
    description: "Scheduler CRON_SECRET, distinct from a Supabase user JWT. An unset or blank secret authorizes no request.",
  });
  const report = registry.register("ScheduledSessionJobsReport", z.object({
    runId: z.string(),
    sessionsChecked: z.number().int().nonnegative(),
    forfeitureDue: z.array(uuid),
    promoted: z.array(uuid),
    autoVerified: z.array(uuid),
    verificationReminders: z.array(uuid),
    failures: z.array(z.object({
      sessionId: uuid.optional(),
      job: z.enum(["EXPIRE_REPLACEMENTS", "PROMOTE", "AUTO_VERIFY", "VERIFICATION_REMINDERS"]),
    })),
  }));
  registry.registerPath({
    method: "get",
    path: "/api/cron/commitments",
    operationId: "runScheduledSessionJobs",
    tags: ["Scheduler"],
    summary: "UC2-05/06 Run Scheduled Session Jobs",
    description: [
      "Scheduler-only operation. It requires Authorization: Bearer <CRON_SECRET>, which Vercel Cron sends; a user JWT does not grant access.",
      "Every accepted call generates a fresh run ID. No body or client-supplied run ID is consumed.",
      "Runs replacement expiry, waitlist promotion and automatic attendance verification in that order.",
      "Auto-verification is due 72 hours after the session ends. Verification reminders are claimed separately.",
      "A successful report can contain per-job failures; those jobs are retried on a later run.",
      "Verification reminders are not claimed until Web Push delivery is configured, so none are lost.",
      "An unset or blank configured secret returns 401. The deployment schedule is configured separately.",
    ].join(" "),
    security: [{ cronAuth: [] }],
    responses: {
      200: { description: "Sweep report, including any individual job failures.",
        content: { "application/json": { schema: report } } },
      401: errorResponse("Missing, incorrect or unconfigured scheduler bearer secret.", "UNAUTHENTICATED", "Authentication is required"),
      500: errorResponse("Unexpected scheduler or dependency setup failure.", "INTERNAL_ERROR", "Internal server error"),
    },
  });
}
