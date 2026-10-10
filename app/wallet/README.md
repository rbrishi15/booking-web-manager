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
   `idempotencyKey` to prevent duplicate intent creation.

---

## HTTP routes

Each route is declared using the shared action wrapper pattern (`walletAction`,
`walletGetAction`, `walletQueryAction` in [`wallet-action.ts`](./wallet-action.ts)),
mirroring [`commitmentAction`](../commit/commitment-action.ts):

```ts
export const POST = walletAction({
  parse: parseTopUpInput,
  run: (dependencies, input) =>
    dependencies.createTopUpIntent(input.userId, input.body),
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
- **Ledger reader**: [`PostgresLedgerReader`](../../lib/money/ledger-read-adapter.ts)
  reads trigger-maintained `wallet_balances` and lists append-only `ledger_entries`.
- **Active holds**: Queries `hold_balances` joined with `sessions` to present held
  amounts with venue, sport, and start times.
- **Top-up intents**: Creates a Stripe PaymentIntent for PayNow (`payment_method_types: ['paynow']`,
  `currency: 'sgd'`) or returns a deterministic simulation intent in offline/test environments.
- **Unavailability**: When server configuration is missing, calls throw
  `WalletApiUnavailableError`, returning `503 WALLET_API_UNAVAILABLE`.

---

## OpenAPI documentation

Mounted in [`openapi.ts`](./openapi.ts) and registered in [`app/openapi/index.ts`](../openapi/index.ts).
Rendered on Swagger UI at `/api-docs` and validated by `@apidevtools/swagger-parser` against
the OpenAPI 3.0.3 specification. The `GET` endpoints accept `bearerAuth` or `loginCookie`;
top-up requires `bearerAuth`.
