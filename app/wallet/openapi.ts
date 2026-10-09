import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { errorResponse, z } from "@/app/openapi/contracts";
import {
  walletSummarySchema,
  walletTransactionsResponseSchema,
  walletTopUpRequestSchema,
  walletTopUpResultSchema,
} from "./contracts";
import { WALLET_API_UNAVAILABLE_MESSAGE } from "./wallet-api-unavailable";

/** Read operations accept the bearer token or, from this site's pages, the Supabase login cookies. */
const readSecurity: Record<string, string[]>[] = [{ bearerAuth: [] }, { loginCookie: [] }];

export function registerWalletApi(registry: OpenAPIRegistry): void {
  registry.registerComponent("securitySchemes", "loginCookie", {
    type: "apiKey",
    in: "cookie",
    name: "sb-<project-ref>-auth-token",
    description:
      "Supabase login cookies set by @supabase/ssr when signing in to this site (large values are split into `.0`, `.1` chunks). Sent automatically by same-origin pages. Accepted only by read (GET) operations; operations that change data require `bearerAuth`.",
  });
  const summarySchema = registry.register(
    "WalletSummary",
    walletSummarySchema,
  );
  const transactionsSchema = registry.register(
    "WalletTransactionsResponse",
    walletTransactionsResponseSchema,
  );
  const topUpRequestSchema = registry.register(
    "WalletTopUpRequest",
    walletTopUpRequestSchema,
  );
  const topUpResultSchema = registry.register(
    "WalletTopUpResult",
    walletTopUpResultSchema,
  );

  registry.registerPath({
    method: "get",
    path: "/api/wallet",
    operationId: "getWallet",
    tags: ["Wallet"],
    summary: "UC1-05 Get wallet balance and active holds",
    description:
      "Returns the authenticated user's wallet details, including available balance, total held funds, and active session fund holds. Available funds reflect spendable SGD cents derived from the append-only double-entry ledger. All balances are non-negative safe integer cents.",
    security: readSecurity,
    responses: {
      200: {
        description:
          "The authenticated user's wallet summary and active holds.",
        content: {
          "application/json": {
            schema: summarySchema,
            example: {
              walletId: "11111111-1111-4111-8111-111111111111",
              userId: "22222222-2222-4222-8222-222222222222",
              availableBalanceCents: 12850,
              heldBalanceCents: 4200,
              currency: "SGD",
              activeHolds: [
                {
                  holdId: "33333333-3333-4333-8333-333333333333",
                  sessionId: "44444444-4444-4444-8444-444444444444",
                  heldCents: 750,
                  originalCents: 750,
                  venueName: "Bukit Timah Community Club",
                  sport: "Tennis",
                  startAt: "2026-10-15T18:00:00.000Z",
                  createdAt: "2026-10-09T10:00:00.000Z",
                },
              ],
            },
          },
        },
      },
      401: errorResponse(
        "Missing, invalid or expired Supabase bearer token.",
        "UNAUTHENTICATED",
        "Authentication is required",
      ),
      403: errorResponse(
        "The authenticated account is deactivated.",
        "INACTIVE_ACCOUNT",
        "An active account is required",
      ),
      404: errorResponse(
        "The authenticated user has no wallet record.",
        "NOT_FOUND",
        "Wallet was not found",
      ),
      500: errorResponse(
        "Unexpected server or database error.",
        "INTERNAL_ERROR",
        "Internal server error",
      ),
      503: errorResponse(
        "Required wallet server settings are missing.",
        "WALLET_API_UNAVAILABLE",
        WALLET_API_UNAVAILABLE_MESSAGE,
      ),
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/wallet/transactions",
    operationId: "listWalletTransactions",
    tags: ["Wallet"],
    summary: "UC1-05 List wallet transaction history",
    description:
      "Returns a paged list of the authenticated user's ledger transactions in reverse chronological order (newest first). Each entry records an append-only money movement (TOP_UP, LOCK, RELEASE, REFUND, FORFEIT, or PAYOUT) with safe integer cents and timestamps. Satisfies REQ-7 and REQ-8.",
    security: readSecurity,
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        before: z.string().datetime().optional(),
      }),
    },
    responses: {
      200: {
        description: "A page of ledger transactions.",
        content: {
          "application/json": {
            schema: transactionsSchema,
            example: {
              items: [
                {
                  transactionId: "55555555-5555-4555-8555-555555555555",
                  kind: "TOP_UP",
                  amountCents: 5000,
                  occurredAt: "2026-10-09T08:00:00.000Z",
                  idempotencyKey: "topup-user-12345",
                  externalReference: "pi_test_1234567890",
                  holdId: null,
                  payoutId: null,
                },
                {
                  transactionId: "66666666-6666-4666-8666-666666666666",
                  kind: "LOCK",
                  amountCents: 750,
                  occurredAt: "2026-10-08T14:30:00.000Z",
                  idempotencyKey: "commit-hold-98765",
                  externalReference: null,
                  holdId: "33333333-3333-4333-8333-333333333333",
                  payoutId: null,
                },
              ],
              nextCursor: "2026-10-08T14:30:00.000Z",
            },
          },
        },
      },
      400: errorResponse(
        "Invalid query parameters.",
        "INVALID_REQUEST",
        "Invalid transaction query",
      ),
      401: errorResponse(
        "Missing, invalid or expired Supabase bearer token.",
        "UNAUTHENTICATED",
        "Authentication is required",
      ),
      403: errorResponse(
        "The authenticated account is deactivated.",
        "INACTIVE_ACCOUNT",
        "An active account is required",
      ),
      404: errorResponse(
        "The authenticated user has no wallet record.",
        "NOT_FOUND",
        "Wallet was not found",
      ),
      500: errorResponse(
        "Unexpected server or database error.",
        "INTERNAL_ERROR",
        "Internal server error",
      ),
      503: errorResponse(
        "Required wallet server settings are missing.",
        "WALLET_API_UNAVAILABLE",
        WALLET_API_UNAVAILABLE_MESSAGE,
      ),
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/wallet/top-up",
    operationId: "createWalletTopUp",
    tags: ["Wallet"],
    summary: "UC1-05 Create PayNow top-up intent",
    description:
      "Initiates a PayNow top-up for the authenticated user's wallet via Stripe Payment Intents (or test simulation when running in offline/local test mode). Requires an idempotency key to prevent duplicate intent creation. Inbound funds credit the wallet only upon confirmed webhook receipt, satisfying CLAUDE.md rule #2.",
    security: [{ bearerAuth: [] }],
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: topUpRequestSchema,
            example: {
              amountCents: 5000,
              idempotencyKey: "topup-attempt-20261009",
            },
          },
        },
      },
    },
    responses: {
      201: {
        description:
          "PayNow top-up payment intent created successfully.",
        content: {
          "application/json": {
            schema: topUpResultSchema,
            example: {
              paymentIntentId: "pi_test_1234567890",
              clientSecret: "pi_test_1234567890_secret_abcdef",
              amountCents: 5000,
              currency: "SGD",
              status: "requires_action",
            },
          },
        },
      },
      400: errorResponse(
        "Malformed JSON or invalid request payload.",
        "INVALID_REQUEST",
        "Invalid top-up request",
      ),
      401: errorResponse(
        "Missing, invalid or expired Supabase bearer token.",
        "UNAUTHENTICATED",
        "Authentication is required",
      ),
      403: errorResponse(
        "The authenticated account is deactivated.",
        "INACTIVE_ACCOUNT",
        "An active account is required",
      ),
      404: errorResponse(
        "The authenticated user has no wallet record.",
        "NOT_FOUND",
        "Wallet was not found",
      ),
      422: errorResponse(
        "Amount must be between SGD 1.00 and SGD 1,000.00.",
        "INVALID_INPUT",
        "Invalid top-up amount",
      ),
      500: errorResponse(
        "Unexpected server or payment provider error.",
        "INTERNAL_ERROR",
        "Internal server error",
      ),
      503: errorResponse(
        "Required wallet server settings are missing.",
        "WALLET_API_UNAVAILABLE",
        WALLET_API_UNAVAILABLE_MESSAGE,
      ),
    },
  });
}
