# /lib/money

**Owner:** Harrison (harr008)

Money type in integer cents, the append-only wallet ledger, derived balances
and non-negative constraints. Implements the five money operations: lock,
release, refund, forfeit, top-up credit. Owns the hourly reconciliation job.

Seam with `/domain`: Rishi defines the ledger interface and the business
rules that call it; Harrison owns the schema and implementation behind that
interface. Neither side changes the other's without review.
