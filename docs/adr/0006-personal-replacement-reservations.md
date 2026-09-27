# ADR-0006: Personal replacement reservations — proposal

- Status: Proposed; awaiting product-owner review
- Date: 2026-09-26

The design conversation explored reserving a late-withdrawing participant's
place for a personal replacement ahead of an ordinary waitlist. That replacement
would refund the named person; the owner could instead release the place to
ordinary admission without an immediate refund.

This would support personal arrangements but adds capacity reservations,
separate admission and refund priorities, link lifecycle rules, and transitions
for people already waiting. A reservation could leave a place unused even when
someone on the waitlist is ready to pay. Simpler alternatives include explicit
replacements without an automatic waitlist or shared openings with first-come
admission.

**No decision is accepted here.** The earlier Accepted label reflected design
assumptions, not product-owner approval, and has been withdrawn. The supplied
participant state diagram is the confirmed baseline; it does not specify a
waitlist, personal links, or reservation priority.

The [product-owner discussion](../discussions/waitlist-and-replacement-options.md)
contains the unmodified diagram, alternative approaches, worked scenarios, and
the pending decision record. Update this ADR only after that review. Aggregate
ownership remains as described in
[ADR-0003](./0003-aggregate-roots-and-boundaries.md).
