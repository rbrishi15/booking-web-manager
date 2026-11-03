# /app/wallet

**Owner:** Rishi (`@rbrishi15`), backend API collaboration with Harrison (`@harr008`)

Implements the **Wallet API** (UC1-05), providing wallet summary, active session fund
holds, paged transaction history derived from the append-only ledger, and PayNow
top-up payment intent creation.

---

## Architectural constraints & non-negotiable rules

This module adheres strictly to the non-negotiable rules defined in `CLAUDE.md`:

1. **Money is integer cents. Always.** All balances, hold amounts, transactions,
   and top-up requests are expressed in non-negative safe integer cents. No floating
   point values or decimals are parsed or persisted.
2. **Only webhooks credit wallets.** `POST /api/wallet/top-up` initiates a Stripe
   PaymentIntent configured for PayNow and returns a `clientSecret` for QR display.
   It does not credit the balance directly. Wallet crediting is performed exclusively
   by the Stripe webhook handler upon confirmed receipt.
3. **Stripe SDK calls are isolated.** Along with `/app/payouts` and `/app/api/webhooks`,
   this directory is one of the designated locations for external Stripe SDK calls.
   Domain and persistence layers move money through the ledger interface without
   importing the Stripe SDK.
4. **Idempotency keys on mutating requests.** Every top-up request requires an
   `idempotencyKey` to prevent duplicate intent creation. Stripe scopes idempotency
   keys to the platform account, not the user, so the server sends Stripe
   `["UC1-05:top-up-intent", userId, idempotencyKey]`; otherwise two users choosing
   the same key would share one PaymentIntent and one wallet would be credited for
   the other's payment.

## Top-up flow (UC1-05)

1. The Add funds button opens a responsive three-stage dialog (shown only with a `pk_test_` publishable key). Stage 1 validates the typed amount into integer cents, then calls `POST /api/wallet/top-up`.
2. [`StripeWalletTopUps.createIntent`](./stripe-top-up-intents.ts) creates a PayNow
   PaymentIntent with a PayNow payment method already attached
   (`payment_method_data: { type: "paynow" }`) and metadata
   `purpose: "wallet_top_up"`, `wallet_id`, `user_id`.
3. The server confirms the PaymentIntent and returns Stripe's PayNow QR image URL plus a validated Stripe-hosted test payment URL encoded in the QR when available. Stage 2 renders the QR inside Booking's dialog. The **Simulate scan** link opens the Stripe-hosted test payment page to authorize or fail the test payment; it never updates wallet balances directly. Stripe.js `retrievePaymentIntent` polls read-only status; closing the dialog never credits or cancels a payment. QR codes expire after one hour and a fresh attempt needs a new idempotency key. The browser credits nothing.
4. Stage 3 shows **Payment confirmed** with the actual amount, PayNow (Test) method and Stripe PaymentIntent ID only after Stripe returns a succeeded status. The Done button closes the dialog; reopening starts a fresh top-up. The message does not claim the webhook has already run.
5. Stripe's `payment_intent.succeeded` webhook
   ([handler](../api/webhooks/top-up-events.ts)) credits `amount_received` to the
   metadata's wallet through [`PostgresTopUpCredits`](../../lib/payments/postgres-top-up-credits.ts):
   one transaction claims a per-PaymentIntent idempotency key, appends the `TOP_UP`
   entry, and records the event in `processed_events`, so a payment credits at most
   once. The page refreshes the balance a few times afterwards.

## Wallet screen

The responsive view has two distinct layouts. Desktop places a pale balance
card beside Funds on hold, above a full-width semantic transaction table with
eight rows per page and numbered navigation. Mobile uses a static dark balance
card, Funds in use and an infinite activity list. TanStack Table owns filtering
and pagination. Each hold links to its session. The mobile Withdraw and desktop
Payouts links open the existing
per-session withdrawal flow; they do not withdraw the available wallet balance.

Desktop All transactions and Active holds switch the activity panel with
keyboard-accessible tabs. Each tab preserves its own filters and page. Active
holds is a semantic Booking / Status / Amount table with eight rows per page,
numbered navigation, booking/sport search and upcoming session-date filters.
Its complete dataset comes from the summary, so pagination never requests
transaction history. A refresh that releases holds keeps the current page in
range. The overview card and mobile Funds in use remain compact lists.

Active holds retains the summary's independent loading and error states.
Hold links open the Joined session through
`/sessions?tab=joined&session=…`.
If the wallet owner booked the session, its hold opens the existing participant
management page instead; hosted sessions are excluded from Joined. The read-only
summary's optional `isBooker` flag selects that destination.

Mobile Pending displays the total of this booker's `REQUESTED` payout attempts,
aggregated without a page limit. It means withdrawals being processed, rather
than available balance or funds held for attendance. An older server response
without this field displays an em dash. Transaction sport metadata is joined
onto the already paginated ledger page and omitted when unavailable.

Add funds opens a single responsive three-stage PayNow modal, not a secondary Stripe overlay.
Amount entry, Stripe's own QR and payment confirmation are successive stages within the same surface. Simulate scan is the primary Stage 2 action when Stripe supplies its test payment URL, and a larger QR view is secondary. Closing the
modal does not cancel a pending Stripe payment, and the verified webhook remains
the only way to credit the wallet.

Both views share React Query's `useInfiniteQuery` cache. Desktop requests older
pages when navigation reaches the end of cached data; mobile observes a
sentinel near the viewport. A continuation failure stops automatic requests
until explicit retry, and fetching never cancels an in-progress refresh.

Search and date filters operate on loaded transactions, with an explicit hint
when older activity is available. Totals appear only after the final cursor.
Only top-ups/refunds have a positive available-balance sign, and locks
have a negative sign. Release, forfeiture and payout amounts stay unsigned
because the API does not expose the viewer's ledger leg or a running balance.

On desktop, the balance card's translucent ribbons move on 24- and 32-second
cycles using CSS transforms. The text and controls stay stationary. Mobile
has no card animations. `prefers-reduced-motion: reduce` disables desktop
motion as well. Artwork is inline SVG; court thumbnails use bundled assets.

---

## HTTP routes

Each route is declared using the shared action wrapper pattern (`walletAction`,
`walletGetAction`, `walletQueryAction` in [`wallet-action.ts`](./wallet-action.ts)),
mirroring [`commitmentAction`](../commit/commitment-action.ts):

```ts
export const POST = walletAction({
  parse: parseTopUpInput,
  run: (dependencies, input) =>
    dependencies.walletTopUp.forUser(input.userId, input.body),
  invalidRequestMessage: "Invalid top-up request",
  successStatus: 201,
});
```

The action wrapper owns the shared HTTP policy: dependency resolution, Supabase
authentication, JSON parsing, domain error status code mapping, and `no-store` headers.
The `GET` routes accept a bearer token or, when no `Authorization` header is sent, the
browser's Supabase login cookies, so the wallet page reads with a plain same-origin
`fetch`. `POST` routes require a bearer token: browsers attach cookies automatically, so
cookie-authenticated writes could be triggered by another site (CSRF).

| Route | Method | Action Helper | Parser | Success Status |
| --- | --- | --- | --- | --- |
| [`/api/wallet`](../api/wallet/route.ts) | `GET` | `walletGetAction` | *(None - user ID from token)* | 200 OK |
| [`/api/wallet/transactions`](../api/wallet/transactions/route.ts) | `GET` | `walletQueryAction` | [`parseTransactionQueryInput`](./transaction-query-input.ts) | 200 OK |
| [`/api/wallet/top-up`](../api/wallet/top-up/route.ts) | `POST` | `walletAction` | [`parseTopUpInput`](./top-up-input.ts) | 201 Created |

---

## Dependency assembly

Assembled in [`use-case-config/wallet.ts`](../../use-case-config/wallet.ts) and cached
lazily via [`server-dependencies.ts`](./server-dependencies.ts):

- **Authentication**: [`bearerOrLoginCookie`](../../lib/supabase/request-authenticator.ts)
  picks one policy per request: [`createSupabaseSessionAuthenticator`](../../lib/supabase/bearer-auth.ts)
  when an `Authorization` header is sent, otherwise
  [`createSupabaseCookieSessionAuthenticator`](../../lib/supabase/cookie-auth.ts), which accepts
  only `GET` requests (an expired login is refreshed and the new cookies are returned with the
  response). Both apply the same [account checks](../../lib/supabase/account-access.ts): the
  profile `account_status` must be `ACTIVE` (inactive
  accounts return `403 INACTIVE_ACCOUNT`; missing profiles return `404 NOT_FOUND`).
- **Application capabilities**: `walletSummary.forUser`,
  `walletTransactions.forUser`, and `walletTopUp.forUser` invoke the wallet use
  cases. Configuration constructs these capabilities; wallet lookup, pagination
  bounds and top-up sequencing stay in `/use-cases/wallet`.
- **Persistence**: `/lib/wallet` owns the read adapter, using
  [`PostgresLedgerReader`](../../lib/money/ledger-read-adapter.ts) for balances and
  ledger history and joining `hold_balances` with `sessions` for active holds.
  [`serialize-wallet.ts`](./serialize-wallet.ts) converts application result
  dates to HTTP strings.
- **Top-up intents**: [`StripeWalletTopUps.createIntent`](./stripe-top-up-intents.ts) creates a
  Stripe PaymentIntent for PayNow (`payment_method_types: ['paynow']`, `payment_method_data: { type: 'paynow' }`, `currency: 'sgd'`).
  Confirmation runs on the server to expose the PayNow QR image and expiry for the custom modal.
  Without a test-mode `STRIPE_SECRET_KEY`, top-up answers `503 TOP_UP_UNAVAILABLE`
  while wallet reads keep working; it no longer returns a simulated intent, whose
  client secret could never be paid.
- **Unavailability**: When server configuration is missing, calls throw
  `WalletApiUnavailableError`, returning `503 WALLET_API_UNAVAILABLE`.

---

## OpenAPI documentation

Mounted in [`openapi.ts`](./openapi.ts) and registered in [`app/openapi/index.ts`](../openapi/index.ts).
Rendered on Swagger UI at `/api-docs` and validated by `@apidevtools/swagger-parser` against
the OpenAPI 3.0.3 specification. The `GET` endpoints accept `bearerAuth` or `loginCookie`;
top-up requires `bearerAuth`.
