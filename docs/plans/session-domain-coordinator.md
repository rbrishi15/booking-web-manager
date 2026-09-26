# Session as a smaller domain coordinator

Status: draft technical plan; waitlist policy awaiting product-owner review.

## Requirements authority

The user clarified that only the supplied participant state diagram was
confirmed with the product owner. Later waitlist and personal-replacement
choices were design assumptions, not approved requirements. The
[product discussion](../discussions/waitlist-and-replacement-options.md) is the
maintained record of those proposals, simpler alternatives, and pending answers.
[ADR-0006](../adr/0006-personal-replacement-reservations.md) is proposed, not accepted.

The user's current first-release proposal is to defer the joining waitlist,
pending product-owner review. Replacement acceptance and allocation still need
decisions. This proposal does not authorize removing existing queue behavior
as part of the structural cleanup.

The diagram establishes immediate refunds at least 30 hours before start,
replacement-dependent refunds for later withdrawal, forfeiture without a
replacement when the session starts, and the depicted cancellation/removal
refunds. It does not define a joining queue, personal-link priority, reserved
capacity, or allocation between several participants awaiting refunds.

Keep three things distinct:

1. The internal restructuring proposed below.
2. Discrepancies between the confirmed diagram and the code, particularly the
   inclusive 30-hour refund boundary.
3. New waitlist product behavior, which requires product-owner review before
   further implementation is treated as approved scope.

The diagram's completed balance also conflicts with the later conversation and
current settlement behavior. Preserve that discrepancy for review rather than
silently replacing the source diagram.

## Technical scope

Keep `Session` as the public command entry point and owner of its state. Move
its detailed calculations into internal modules without changing aggregate
ownership, existing public imports, signatures, getters, or established results.
Application use cases, persistence, and payment-provider coordination remain
separate work.

This refines the implementation of
[ADR-0002](../adr/0002-constructor-based-domain-hydration.md) and
[ADR-0003](../adr/0003-aggregate-roots-and-boundaries.md). The new
`offerReplacementToWaitlist` action already added in the working copy is a
provisional product extension, not a prerequisite for this structural cleanup.
Its disposition depends on the product review.

## Proposed responsibility split

| Module | Responsibility |
| --- | --- |
| `session-admission.ts` | Access, eligibility, joining, FIFO promotion, waitlist re-entry, and replacement-refund calculations under the selected policy. |
| `session-roster.ts` | Waitlist departure, withdrawal, removal, cancellation, replacement expiry, attendance, and shared roster calculations. |
| `session-settlement.ts` | Settlement batches, completed holds, and financial instructions. |
| `session-validation.ts` | Construction invariants, settlement-data validation, defensive copies, and session-specific ID/date checks. |

`Session` retains construction, getters, shared lifecycle and booker checks,
payout-attempt history, and final state assignments. Short commands may remain
inline. `Participation` and `FundHold` continue enforcing their local rules.

Helpers receive operation-specific inputs and return candidate changes and
complete results. They do not mutate `Session`, receive a generic session
snapshot, or call back into private methods. Validation supports roster
calculations; admission and settlement may use roster helpers. References back
to existing session types are type-only imports. Internal modules stay out of
the public domain exports.

Admission returns candidate participations, queue sequence, and its public
result. Roster calculations return changed participations and complete results.
Settlement returns batches or completed participations and financial
instructions. `Session` applies changes only after calculations and result
construction succeed.

Joining and promotion currently install a committed participation before
calculating a replacement refund. Fix that partial-update risk explicitly.
Preserve defensive copying, hydration defaults, public result shapes, and
existing error types, codes, messages, and validation order during extraction.
Track any approved business corrections separately. Judge the split by how
easily commands and rules can be found and followed, with no arbitrary line
limit.

## Compatibility facts from the implementation

These describe existing behavior, not evidence of product-owner approval for
waitlist policy.

- Join checks supplied IDs before lifecycle, access, and eligibility. Promotion
  checks lifecycle, returns `NONE` for an empty queue, and only then validates
  its hold ID. Ineligible promotion returns `SKIPPED` and removes the first
  waiter; promotion does not repeat private-access checks.
- Current admission refunds the oldest awaiting withdrawal regardless of the
  link used. The proposed link-owner refund rule differs from this behavior;
  it is not yet an approved product defect. Financial instructions retain their
  `LOCK`, then `REFUND` order.
- Settlement preparation interleaves candidate replacement expiry and attendance
  checks with destination, pending-attempt, and payout-history checks. Moving
  history checks earlier changes error precedence.
- Failed payout IDs and idempotency keys remain recorded and cannot be reused.
  The added test isolates an old key with a new payout ID. This is existing
  behavior retained by the discussion, separate from waitlist policy and not
  specified by the participant diagram.
- Each omitted payout-history collection defaults independently to its pending
  batch identifier, or to empty when no batch exists. Explicitly empty history
  with a pending batch fails validation.
- Completion without a pending payout reports `INVALID_STATE`; a mismatched
  pending payout reports `STALE_PAYOUT`. Failure reports `STALE_PAYOUT` in both
  cases. Preserve the asymmetry and session-specific date errors.
- Constructors reject some duplicate IDs that commands do not comprehensively
  recheck. Extraction must not silently add full constructor validation after
  every command.

Small prefix validation calls may remain in command wrappers. A command may use
multiple pure calculation stages to preserve error precedence. The atomicity
regressions can inject a narrowly scoped, restored failure in a child's existing
refund method while invoking the public Session command; no production injection
mechanism is needed.

## Provisional changes already in the working copy

| Change | Current state | Approval distinction |
| --- | --- | --- |
| Failed payout-key reuse regression and fresh-key assertion | Added and passing. | Characterizes existing payout behavior; separate from the waitlist proposal. |
| Supplied replacement token checked before ordinary access can succeed | Implemented, with two used-link regressions. | Partial implementation of a proposed link rule; awaiting product-owner review. |
| `Session.offerReplacementToWaitlist` and corresponding immutable child transition | Implemented. Clears the token, preserves the hold and withdrawal time, and returns no financial instructions. | New proposed product capability; awaiting product-owner review. |
| Offer-to-waitlist lifecycle, rejection, and original-withdrawal-order tests | Five tests added and passing. | Examples of discussion assumptions, not accepted product requirements. |
| Reserved capacity, refunding the personal-link owner, direct personal acceptance by a waitlisted invitee | Not implemented. | Product proposals awaiting review. |
| Rejoining before start after a late withdrawal, with an available place, no replacement, and the original share still held | Not implemented; current admission rejects withdrawn participants. | Proposed return with the existing hold and no additional charge; awaiting product-owner review. |
| Immediate refund at exactly 30 hours | Not implemented; code still uses the old boundary. | Difference from the confirmed diagram, separate from waitlist choices. |
| Internal module extraction | Not started. | Technical cleanup remains separate from adopting product proposals. |

The documentation-only reclassification leaves these code and test changes
intact. After review, reconcile them with the selected product behavior before
merging or treating them as requirements. Passing tests alone are not approval.

## Verification for the structural work

Extract validation, roster, admission, then settlement, running affected tests
after each stage. Keep tests at the public `Session` interface. Preserve coverage
for admission, replacement refunds, withdrawal timing, cancellation, attendance,
reconstruction, payout retries, stale callbacks, and mutation isolation.

Add join and promotion regressions proving that a failed replacement-refund
calculation leaves the roster, queue sequence, and holds unchanged. Add omitted
payout-history default coverage, including each history independently omitted.
Retain the completed failed-key reuse regression. Add or revise business tests
only for the policy selected after product review, including boundary tests for
any separately approved diagram/code correction.

Finish with the full test suite, type checking, and linting. The supplied original
baseline was 117 passing session-domain tests. The last verification before this
documentation revision was 405 passing tests and 40 existing todo cases, with
passing type checking and linting. That count describes the current working
copy, including provisional tests; it does not validate product requirements.

Update the domain guide with the responsibility split and future load/invoke/save
coordination. Use semantic `refactor(sessions): …` commits and explicitly identify
the partial-update fix. Further implementation of the expanded waitlist proposal
follows the product owner's recorded decisions.
