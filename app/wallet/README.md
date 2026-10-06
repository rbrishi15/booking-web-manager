# /app/wallet

**Owner:** Rishi (rbrishi15)

`/wallet` currently shows an authenticated "Wallet is under development" page
inside the standard signed-in shell. The navigation and the Settings transaction
history link both reach this page, with working exits to Home and hosted sessions.
Replace the placeholder when the wallet interface is implemented.

Wallet interface: balance, held funds by session, transaction history.
Stripe PayNow top-up via Payment Intents. This directory, `/app/payouts` and
`/app/api/webhooks` are the only places the Stripe SDK is called from — see
CLAUDE.md rule #3. Everything else moves money through the domain ledger.
