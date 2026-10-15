# /app/api/webhooks

**Owner:** Rishi (rbrishi15)

`POST /api/webhooks/stripe` — the Stripe webhook endpoint. The sole writer for
inbound money (CLAUDE.md rule #2): never credit a wallet from a client-side
callback.

- **Signature verification:** the raw body is checked against each configured
  signing secret before anything is parsed. A missing or bad signature answers
  400 and reaches no handler.
- **At-most-once:** each handler records the event ID in `processed_events`
  in the same transaction as its effect, so a redelivered or replayed event
  changes nothing.
- **Retries:** a handler failure answers 500 and Stripe retries; the dedup
  above makes that safe. Unhandled event types are acknowledged with 200.

| Event | Effect |
| --- | --- |
| `account.updated` | UC1-07: completes or fails a pending payout setup ([handler](./payout-account-events.ts)); the account is re-read from Stripe rather than trusted from the event body |
| `payment_intent.succeeded` | UC1-05: credits a wallet top-up ([handler](./top-up-events.ts)) — only intents marked `purpose: "wallet_top_up"`, for `amount_received` in SGD cents, at most once per PaymentIntent |

## Configuration

| Variable | Use |
| --- | --- |
| `STRIPE_WEBHOOK_SECRET` | Platform endpoint signing secret, or the `stripe listen` secret locally |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Optional: the connected-account endpoint's secret. Stripe sends `account.updated` for connected accounts to an endpoint created with "Listen to events on Connected accounts", which has its own secret |

Without a secret the endpoint answers 503. Locally:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe \
  --forward-connect-to localhost:3000/api/webhooks/stripe
```

`stripe listen` prints one `whsec_…` secret for both; put it in
`STRIPE_WEBHOOK_SECRET`. Test events: `stripe trigger account.updated`. Never
write a test that depends on live Stripe; the unit tests sign payloads offline
with `stripe.webhooks.generateTestHeaderString`.
