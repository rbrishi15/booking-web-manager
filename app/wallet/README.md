# /app/wallet

**Owner:** Rishi (rbrishi15)

Wallet interface: balance, held funds by session, transaction history.
Stripe PayNow top-up via Payment Intents. This directory, `/app/payouts` and
`/app/api/webhooks` are the only places the Stripe SDK is called from — see
CLAUDE.md rule #3. Everything else moves money through the domain ledger.
