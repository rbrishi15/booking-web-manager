import { z } from "zod";

// Browser copies of the wallet API response contract (Harrison's PR #59, app/wallet/contracts.ts).
// Only the fields this page shows are required; unknown fields are ignored.
const cents = z.number().int().safe().nonnegative();
// An unparseable date would make the page's date formatting throw, so reject it here.
const timestamp = z.string().datetime({ offset: true });

const walletSummarySchema = z.object({
  availableBalanceCents: cents,
  heldBalanceCents: cents,
  activeHolds: z.array(z.object({
    holdId: z.string(),
    sessionId: z.string(),
    heldCents: cents,
    originalCents: cents,
    venueName: z.string().optional(),
    sport: z.string().optional(),
    startAt: timestamp.optional(),
  })),
});

const transactionKind = z.enum(["TOP_UP", "LOCK", "RELEASE", "REFUND", "FORFEIT", "PAYOUT"]);
const transactionsSchema = z.object({
  items: z.array(z.object({
    transactionId: z.string(),
    kind: transactionKind,
    amountCents: cents,
    occurredAt: timestamp,
  })),
  nextCursor: z.string().nullable(),
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export type WalletSummary = z.infer<typeof walletSummarySchema>;
export type WalletTransactionsPage = z.infer<typeof transactionsSchema>;
export type WalletTransactionKind = z.infer<typeof transactionKind>;

export type WalletLoad<T> =
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "error"; readonly code: string; readonly message: string };

/** `signal` cancels a request React Query no longer needs (for example after Retry). */
export interface WalletTransport {
  readonly loadSummary: (signal?: AbortSignal) => Promise<WalletLoad<WalletSummary>>;
  /** `before` is the previous page's `nextCursor`. */
  readonly loadTransactions: (before?: string, signal?: AbortSignal) => Promise<WalletLoad<WalletTransactionsPage>>;
}

export const WALLET_URL = "/api/wallet";
export const WALLET_TRANSACTIONS_URL = "/api/wallet/transactions";
export const TRANSACTIONS_PAGE_SIZE = 20;

export const WALLET_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UNAUTHENTICATED: "Log in again to see your wallet.",
  INACTIVE_ACCOUNT: "This account can't use a wallet.",
  NOT_FOUND: "We couldn't find your wallet. Please contact support.",
  WALLET_API_UNAVAILABLE: "The wallet is temporarily unavailable. Please try again later.",
};

/**
 * Requests one wallet API resource and validates the reply. The browser sends its login
 * cookies with this same-origin request; the API checks them, so no token is handled here.
 */
async function getJson<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<WalletLoad<T>> {
  try {
    const timeout = AbortSignal.timeout(20_000);
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const body: unknown = await response.json();
    if (response.ok) {
      const parsed = schema.safeParse(body);
      if (parsed.success) return { status: "ready", data: parsed.data };
      return { status: "error", code: "UNEXPECTED_RESPONSE", message: "We couldn't read your wallet. Please try again." };
    }
    const failure = errorSchema.safeParse(body);
    const code = failure.success ? failure.data.error.code : "UNEXPECTED_ERROR";
    return { status: "error", code, message: WALLET_ERROR_MESSAGES[code] ?? "We couldn't load your wallet. Please try again." };
  } catch {
    return { status: "error", code: "NETWORK_ERROR", message: "We couldn't load your wallet. Check your connection and try again." };
  }
}

/** UC1-05: reads the signed-in user's balances and held funds. Reads only; no money moves. */
export const walletTransport: WalletTransport = {
  loadSummary: (signal) => getJson(WALLET_URL, walletSummarySchema, signal),
  loadTransactions: (before, signal) => {
    const params = new URLSearchParams({ limit: String(TRANSACTIONS_PAGE_SIZE) });
    if (before !== undefined) params.set("before", before);
    return getJson(`${WALLET_TRANSACTIONS_URL}?${params}`, transactionsSchema, signal);
  },
};
