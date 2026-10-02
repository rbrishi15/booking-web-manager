# ADR-0013: Cancellation preserves terminal participations

- Status: Accepted
- Date: 2026-10-02
- Refines cancellation history under ADR-0009 and ADR-0010.
- Number 0012 is reserved by the separately reviewed pricing PR #39.

Cancelling a Session cancels its live roster and refunds outstanding holds, while
preserving already REMOVED and CANCELLED participations and their terminal holds
unchanged. Rewriting a removal as cancellation would erase the departure reason;
rejecting the whole cancellation would prevent a booker from closing a valid
session after a removal. A CANCELLED Session therefore admits only CANCELLED or
REMOVED participants, all without active funds. Complete-roster validation still
requires every owned record and forbids altering terminal history. Application
access requires an active account; the underlying Booker's inactive-owner domain
policy remains unchanged.
