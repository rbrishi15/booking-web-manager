/**
 * UC2-05 presentation contracts for the Withdraw / Leave-waitlist screens. The screens call
 * these functions and never fetch directly; stories and tests pass fakes
 * (`_components/withdrawal-fakes.ts`). Real transports will call:
 * - the joined-sessions list (API pending from the UC2-05 owner),
 * - GET /api/sessions/{sessionId}/withdrawal-preview,
 * - POST /api/sessions/withdraw and POST /api/sessions/waitlist/leave.
 */

/** A session the player holds a place in (COMMITTED) or is waiting for (WAITLISTED). */
export interface JoinedSessionItem {
  readonly sessionId: string;
  readonly venueName: string;
  readonly sport: string;
  readonly region: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly status: "COMMITTED" | "WAITLISTED";
  /** The per-place share in integer cents, held only while COMMITTED. */
  readonly bookingShareCents: number;
}

/** What withdrawing now would do, calculated by the server (integer cents). */
export interface WithdrawalPreview {
  /** REFUNDED: more than 30 hours before start. AWAITING_REPLACEMENT: 30 hours or less. */
  readonly kind: "REFUNDED" | "AWAITING_REPLACEMENT";
  readonly refundCents: number;
  readonly heldCents: number;
}

export type PreviewWithdrawal = (sessionId: string) => Promise<
  | { readonly status: "ready"; readonly preview: WithdrawalPreview }
  | { readonly status: "error"; readonly message: string }
>;

/** ADR-0006: open the place to the waitlist, or reserve it for one named person. Cannot change later. */
export type Replacement =
  | { readonly mode: "OPEN_SLOT" }
  | { readonly mode: "DIRECT_INVITE"; readonly inviteeId: string };

/** Someone the player may name as their replacement. */
export interface ReplacementCandidate {
  readonly userId: string;
  readonly displayName: string;
}

/** A failed action. `unconfirmed`: it may or may not have happened; retry with the same request. */
export interface ActionError {
  readonly status: "error";
  readonly code: string;
  readonly message: string;
  readonly unconfirmed: boolean;
}

/** One withdrawal. Reuse the same idempotency key and choice when retrying it (CLAUDE.md rule #6). */
export interface WithdrawRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly replacement: Replacement;
}

export type WithdrawFromSession = (request: WithdrawRequest) => Promise<
  | { readonly status: "withdrawn"; readonly kind: WithdrawalPreview["kind"]; readonly refundedCents: number }
  | ActionError
>;

/** One waitlist departure. Reuse the same idempotency key when retrying it. */
export interface LeaveWaitlistRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
}

export type LeaveWaitlist = (request: LeaveWaitlistRequest) => Promise<{ readonly status: "left" } | ActionError>;
