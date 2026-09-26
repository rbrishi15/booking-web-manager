# ADR-0007: Participant behavior and the Session roster

- Status: Accepted
- Date: 2026-09-26
- Supersedes: participant responsibility routing in
  [ADR-0003](./0003-aggregate-roots-and-boundaries.md) and admission routing in
  [ADR-0004](./0004-participant-join-and-session-admission.md).

## Context

`Participant` previously forwarded its loaded `User` to `Session`, which decided
both person-specific rules and rules involving the shared roster. Extracting
those calculations into internal session modules shortened the root without
giving the participant role its own business behavior.

We want participants to own their eligibility, funding, and voluntary departure
decisions while preserving the session's ownership of participation records and
holds. Moving the records into `Participant`, exposing roster setters, or making
callers apply prepared changes would weaken the shared capacity and atomicity
boundary.

## Decision

`Participant` is a role over a fully loaded `User`, with no separate repository
or persisted lifecycle. It owns current account-status checks, loaded reliability
and available-funds checks, hold creation from that user's wallet, authorization
over its participation, and the immediate-refund versus awaiting-replacement
withdrawal decision. Joining and promotion share its eligibility and hold-creation
behavior. Account status is read when the action runs, including after a role
was created and its user was deactivated.

`Session` continues to own `Booking`, `Participation`, and `FundHold` state. It
checks lifecycle, private access and replacement links, duplicate enrollment,
capacity, queue order, and waitlist re-entry. It finds the owned participation
for a departure and selects/refunds the existing withdrawal matched to a new
commitment. It invokes the participant's calculations and installs the complete
roster change only after all children, financial instructions, and any replacement
refund have been constructed successfully.

The participant action surface is:

```ts
const participant = user.asParticipant();
const admission = participant.join(session, {
  participationId,
  holdId,
  now,
});

participant.withdraw(session, withdrawalCommand);
participant.leaveWaitlist(session, leaveWaitlistCommand);
participant.offerReplacementToWaitlist(session, replacementCommand);
```

`ParticipantJoinCommand` is declared beside `Participant`; it is no longer an
alias of a session command. Commands still contain explicit IDs, time, and action
options rather than copied account facts. Existing result and financial-instruction
contracts remain unchanged.

The guarded session collaboration operations are
`admitParticipant(participant, command)`,
`applyParticipantWithdrawal(participant, command)`,
`removeWaitlistedParticipant(participant, command)`, and
`releaseParticipantReplacement(participant, command)`. These replace the previous
direct joining and voluntary-departure entry points without compatibility
wrappers. They check session conditions and invoke participant calculations;
calling them directly does not bypass ownership or lifecycle checks. There are
no generic roster setters, mutation callbacks, or independently applicable change
plans. Immutable child transitions still validate their local state.

`Session.promoteNext(participant, command)` retains FIFO selection and verifies
that the supplied participant owns the first waiting record. It obtains the
eligibility decision and hold from `Participant`; `NONE` and `SKIPPED` outcomes
are preserved. Session admission no longer depends on `User`, reads wallet
balances, or decides the withdrawal cutoff. Existing booker eligibility checks
when creating a session remain unchanged.

Future use cases load coherent `User` and `Session` state, obtain the participant
role, invoke its action, and save the session with returned ledger instructions
in one unit of work. They do not save a participant role or individual child
replacement. Loaded wallet history, reliability, and memberships retain the
hydration and refresh contract of ADR-0004: reload after ledger or membership
writes, and let transaction adapters prevent concurrent overspending.

## Consequences

- Participant behavior has a domain home without changing aggregate ownership.
  Session remains the only installer of roster changes and can reject an entire
  change before mutating any participation, hold, or queue sequence.
- Joining and voluntary-departure scenarios live in Participant suites. Session
  suites retain capacity, promotion, guarded-boundary, administration, and
  settlement coverage. Failed replacement-refund scenarios verify atomicity
  through both joining and promotion.
- Booker administration, attendance, cancellation, settlement, persistence,
  schemas, and payment integration are unchanged. Domain tests do not establish
  database transaction or concurrency guarantees.
- This is a responsibility refactor, not a product-policy change. Exactly 30
  hours before start still awaits replacement; the inclusive-refund discrepancy
  and provisional replacement/waitlist policies remain tracked in the
  [product discussion](../discussions/waitlist-and-replacement-options.md).
  [ADR-0006](./0006-personal-replacement-reservations.md) remains proposed.
