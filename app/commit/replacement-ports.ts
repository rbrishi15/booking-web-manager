import type { ActionError } from "./withdrawal-ports";

/**
 * UC2-05 presentation contracts for accepting a replacement invitation (ADR-0006: a departing
 * participant names one person, who must explicitly accept). `replacement-transport.ts` maps the
 * list and accept APIs' replies to these types. Stories use the fakes in
 * `_components/replacement-fakes.ts`; `/sessions/joined` uses the real transport.
 */

/** A place reserved for the player by someone who withdrew. */
export interface ReplacementInvitation {
  readonly sessionId: string;
  readonly venueName: string;
  readonly sport: string;
  readonly region: string;
  readonly startAt: string;
  readonly endAt: string;
  /** The share held from the player's wallet on accepting, in integer cents. */
  readonly bookingShareCents: number;
}

/** Loads the player's pending invitations; throws when they cannot be loaded (React Query style). */
export type LoadReplacementInvitations = () => Promise<readonly ReplacementInvitation[]>;

/** One acceptance. Reuse the same idempotency key when retrying it (CLAUDE.md rule #6). */
export interface AcceptReplacementRequest {
  readonly sessionId: string;
  readonly idempotencyKey: string;
}

export type AcceptReplacement = (request: AcceptReplacementRequest) => Promise<
  | { readonly status: "accepted"; readonly heldCents: number }
  | ActionError
>;
