/**
 * UC2-05 presentation contracts for the Withdraw / Leave-waitlist screens. They are shaped for
 * the screens, not copied from the HTTP replies: `withdrawal-transport.ts` validates each API
 * reply with Zod and maps it to these types explicitly (see the table there), and
 * `tests/app/commit/withdrawal-contract.test.ts` checks that mapping against the real routes.
 * Stories use the fakes in `_components/withdrawal-fakes.ts`; `/sessions/joined` uses the real
 * transports. React Query calls these through the flow hooks, which
 * turn error results into thrown `SessionActionError`s.
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

/** Loads the player's joined sessions; throws when they cannot be loaded (React Query style). */
export type LoadJoinedSessions = () => Promise<readonly JoinedSessionItem[]>;

/** What withdrawing now would do, calculated by the server (integer cents). */
export interface WithdrawalPreview {
  /** REFUNDED: at least 30 hours before start. AWAITING_REPLACEMENT: less than 30 hours. */
  readonly kind: "REFUNDED" | "AWAITING_REPLACEMENT";
  readonly refundCents: number;
  readonly heldCents: number;
}

export type PreviewWithdrawal = (sessionId: string) => Promise<
  | { readonly status: "ready"; readonly preview: WithdrawalPreview }
  | { readonly status: "error"; readonly message: string }
>;

/**
 * ADR-0006: open the place to the waitlist, or reserve it for one named person. ADR-0024: when
 * late, give the share to the booker and close the place instead. Cannot change later.
 */
export type Replacement =
  | { readonly mode: "OPEN_SLOT" }
  | { readonly mode: "DIRECT_INVITE"; readonly inviteeId: string }
  | { readonly mode: "FORFEIT" };

/** Someone the player may name as their replacement, found by their user ID (ADR-0021). */
export interface ReplacementCandidate {
  readonly userId: string;
  /** Their user ID without "@". */
  readonly handle: string;
  readonly displayName: string;
}

/** Finds the active player holding exactly this user ID, to name as the replacement. */
export type FindReplacementCandidate = (handle: string) => Promise<
  | { readonly status: "found"; readonly candidate: ReplacementCandidate }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string }
>;

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
  | {
      readonly status: "withdrawn";
      /** FORFEITURE_DUE: a late forfeit; the share goes to the booker and the place is closed. */
      readonly kind: WithdrawalPreview["kind"] | "FORFEITURE_DUE";
      readonly refundedCents: number;
    }
  | ActionError
>;

/** One waitlist departure. Reuse the same idempotency key when retrying it. */
export interface LeaveWaitlistRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
}

export type LeaveWaitlist = (request: LeaveWaitlistRequest) => Promise<{ readonly status: "left" } | ActionError>;
