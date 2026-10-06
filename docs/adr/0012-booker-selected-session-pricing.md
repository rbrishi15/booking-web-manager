# ADR-0012: Booker-selected session pricing

- Status: Accepted
- Date: 2026-10-02
- Partially supersedes: the derived booking-share calculation in ADR-0008 and
  ADR-0010. Role authorization, aggregate ownership and ledger rules remain unchanged.

UC2-02 now lets the booker choose a price, including above-cost collection,
rather than limiting the platform to reimbursement. The initial suggestion is
the booking cost divided equally across slots, rounded down in integer cents.
The chosen price ranges from half that suggestion rounded up (at least one
cent) to twice the suggestion, capped so full-slot collection stays within safe
integer cents. This replaces the old equal-split-only policy by explicit user
decision; it is not a demand or reliability prediction. Clients omitting the
new `config.pricePerSlotCents` field retain the equal-split default.

The domain validates the choice and stores an immutable booking share in
Session. Persistence hydrates the quoted share rather than recalculating it.
Discovery, admission and replacement holds use that amount, while refunds and
settlement continue to use the historical hold amounts. Migration 0008 changes
only the pricing constraint, preserving existing sessions and financial records.
Creation still moves no funds and the platform takes no commission.
