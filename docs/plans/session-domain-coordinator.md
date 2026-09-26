# Session as a smaller domain coordinator

Status: implemented. Product-policy proposals remain awaiting product-owner review.

## Implemented scope

`Session` remains the public command entry point and owner of its state. Detailed
calculations now live alongside it in `domain/sessions/session/`. The folder
entry point preserves existing imports and exports only Session and its public
command/construction types. Public methods,
argument shapes, return types, getters, exports, and import paths are preserved.
`Participation` and `FundHold` continue enforcing their local rules.

The compatibility baseline was the branch before this cleanup, including its
provisional replacement-link checks and offer-to-waitlist action. Preserving
those behaviors is not product approval. Removing the joining waitlist, adding
personal reservations or late-withdrawal rejoining, changing refund allocation,
and correcting the inclusive 30-hour boundary remain separate business changes.
The [product discussion](../discussions/waitlist-and-replacement-options.md) keeps
the supplied diagram, user proposals, and outstanding product-owner decisions.
[ADR-0006](../adr/0006-personal-replacement-reservations.md) remains proposed.

Application use cases, persistence, ledger implementation, and payment-provider
coordination remain outside this cleanup. Aggregate ownership remains as defined
by [ADR-0003](../adr/0003-aggregate-roots-and-boundaries.md), with construction and
copying conventions from [ADR-0002](../adr/0002-constructor-based-domain-hydration.md).

## Responsibility split

| Module | Responsibility |
| --- | --- |
| `session/session-validation.ts` | Construction invariants, settlement-data validation, defensive copies, and session-specific ID/date checks. |
| `session/session-roster.ts` | Shared roster operations, waitlist departure, withdrawals, offering replacements to the waitlist, removal, cancellation, replacement expiry, and attendance. |
| `session/session-admission.ts` | Access, eligibility, joining, FIFO promotion, waitlist re-entry, hold creation, and replacement-refund calculations. |
| `session/session-settlement.ts` | Settlement preparation, batch construction, completed holds, and financial instructions. |

`Session` retains construction, getters, shared lifecycle and booker checks,
payout-attempt history, final state assignments, and short commands such as
visibility changes and payout failure.

Helpers take operation-specific readonly inputs and return complete candidate
changes and results. They do not accept a mutable session, generic state snapshot,
or callbacks into private methods. Roster calculations may use validation;
admission and settlement may use roster helpers and validation. References back
to session types are type-only imports. No helper is added to the public exports.
The [domain guide](../../domain/README.md#session-command-calculations) explains
these boundaries and how future use cases load, invoke, and save the root.

## Atomicity and compatibility

Joining and promotion previously installed a committed participation before
calculating its replacement refund. Both now calculate the candidate roster,
queue sequence, refund, and complete financial result before applying changes.
A failed refund leaves the original roster, queue sequence, and holds unchanged.
Roster and settlement commands likewise build complete results before assignment.

Validation order, error codes/messages, FIFO order, refund timing, payout retries,
hydration defaults, and defensive copying are preserved. In particular:

- Promotion checks lifecycle before returning `NONE` for an empty queue, and
  validates the hold ID only if there is a waiter.
- Settlement prepares the candidate roster and checks attendance/destination
  before checking root-owned attempt history, then builds the batch. A rejected
  preparation never applies candidate replacement expiry.
- Omitted payout histories independently default to their pending identifiers,
  or empty without a pending payout. Explicitly empty required histories still
  fail validation. Failed payout IDs and keys remain unavailable for reuse.
- Completion without a pending payout retains `INVALID_STATE`; a mismatched
  completion and missing/mismatched failure callback retain `STALE_PAYOUT`.
- Session-specific date checks remain in use. Commands do not add whole-roster
  constructor validation after every transition.

## Verification and commits

The inspected pre-cleanup session-domain baseline was 125 passing tests.
Added six payout-history default scenarios, separate join/promotion refund-failure
regressions, and two empty-queue promotion precedence scenarios. The refund-failure
tests each reproduced the partial update before the corresponding fix. Tests stay
at the public Session interface; narrowly scoped child-method spies are restored
in `finally` blocks. Existing failed-key reuse and mutation-isolation tests remain.

Extraction proceeded in small semantic commits: validation, shared roster helpers,
roster commands, access/eligibility, joining, promotion, settlement preparation,
and settlement completion. The joining and promotion commits explicitly identify
the partial-update fixes. A final compatibility pass consolidates imports and
checks the private-access error message and empty-queue precedence.

Affected session-domain tests and type checking passed after each extraction.
Final verification: 135 session-domain tests pass; the full suite has 415 passing
tests and 40 existing todo cases. Type checking, linting, and the diff whitespace
check pass. Public Session declarations match the pre-refactor baseline, and the
public domain exports are unchanged.
