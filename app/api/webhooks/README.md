# /app/api/webhooks

**Owner:** Rishi (rbrishi15)

Stripe webhook handler: signature verification, event-ID deduplication
against `processed_events`, replay safety. The sole writer for inbound money
— see CLAUDE.md rule #2. Never credit a wallet from a client-side callback.
