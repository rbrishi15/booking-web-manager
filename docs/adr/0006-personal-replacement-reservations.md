# ADR-0006: Named personal replacements and the session waitlist

- Status: Accepted for the confirmed scope below; separate financial proposals remain under review
- Date: 2026-09-27
- Supersedes: the proposal-only status of this ADR, the 26 September proposal to defer the joining waitlist, the proposal to release a personal place to the waitlist, and replacement-link/token admission

## Confirmed scope

On 27 September 2026, the user confirmed the session queue waitlist and two
choices when a participant leaves: invite someone to replace them, or open the
place to groups / the public waitlist. The user clarified that the invitation
is for **one named person**. The place is like an airplane seat: one departing
participant can invite one person to take that one place.

The user chose a **direct invitation by user ID with explicit recipient
acceptance**. Replacement links and tokens are removed from the flow.

The user further clarified that these choices are **strictly either/or at
withdrawal**. A participant cannot invite someone and then open that same place
to the waitlist, and cannot change the allocation choice after withdrawing.
This rejects the earlier offer-to-waitlist proposal. It does not prevent a named
invitee who is already queued from accepting their own reserved place.

The personal choice reserves one place for its named invitee until they
explicitly accept, subject to existing session cancellation and start rules.
It cannot invite several people to compete or let an ordinary entrant take the
reserved place. The open choice makes the place available through the session's
existing group/public access rules and joining queue.

This replaces the earlier proposal to postpone the joining waitlist. It does
not approve every scenario in the
[product discussion](../discussions/waitlist-and-replacement-options.md), whose
financial, rejoining, completion-balance, and cutoff questions remain separate.

## Domain representation and consequences

`DIRECT_INVITE` replaces `INVITE_LINK` and stores one `replacementInviteeId`;
there is no `replacementToken`. A future application loads the authenticated
invitee's `User` and calls its participant role's
`acceptReplacement(session, { participationId, holdId, now })` action. The user's
identity authorizes their unique active pending reservation, including access
to a private session. Eligibility and funding checks still apply. The invitation
reserves one place after either an early or a late withdrawal, independently of
whether the departing person's share is still held.

The named invitee can explicitly accept from any position in the joining
waitlist. A successful acceptance consumes that one reservation through
the entrant's `replacesParticipationId`; a second acceptance cannot reuse it.
Other people keep their ordinary queue order. Failed eligibility, funding, or
recording leaves the reservation, funds, and any existing queue position intact.

`join` and `promoteFromWaitlist` cannot accept an invitation implicitly. They
reject a recipient with a pending invitation without changing that invitation
or their existing queue entry. Promotion retains FIFO order and must await the
invited queue head's response rather than skip them or charge them automatically.

Ordinary admission and promotion for other people use only unreserved capacity,
retain existing visibility/membership requirements and FIFO order, and match the
oldest eligible `OPEN_SLOT` late withdrawal. Personal acceptance targets its own departing
participant, without consuming another person's ordinary refund opportunity.

These workflows retain the existing requirement that the entrant's full share
is held on successful admission. A late withdrawal is then refunded for the
person actually replaced; an early withdrawal has already been refunded and
receives no second refund. This is the financial behavior implemented alongside
the confirmed allocation rule, not a new blanket approval of the financial
proposals recorded in the discussion.

Withdrawal records either `DIRECT_INVITE` for one named person or `OPEN_SLOT` for
ordinary admission. That choice cannot be changed afterward. The earlier
`offerPlaceToWaitlist` action and the transition that converted a personal
reservation to `OPEN_SLOT` are removed. The rejected switch is not a deferred
workflow. There is no new invitation-decline or invitation-cancellation action;
session cancellation, start timing, and existing financial rules remain separate.

## Integration boundary

Aggregate ownership remains as described in
[ADR-0003](./0003-aggregate-roots-and-boundaries.md), with current role workflows
and recording boundaries in [ADR-0009](./0009-role-workflows-and-session-recording.md).
Participant and Session supply the domain behavior. This repository has no
departure-choice UI, invitation delivery, application coordinator, or persistence
adapter for the flow. Future adapters must persist the invitation's recipient
and commit acceptance, reservation consumption, and ledger instructions in one
transaction. Domain checks alone do not establish database concurrency safety.

The existing exactly-30-hour refund discrepancy and the proposal to rejoin
after a late withdrawal are unchanged by this decision.
