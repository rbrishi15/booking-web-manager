import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

// Browser copies of the wallet API response contract (Harrison's PR #59, app/wallet/contracts.ts).
// Only the fields this page shows are required; unknown fields are ignored.
const cents = z.number().int().safe().nonnegative();

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
    startAt: z.string().optional(),
  })),
});

const transactionKind = z.enum(["TOP_UP", "LOCK", "RELEASE", "REFUND", "FORFEIT", "PAYOUT"]);
const transactionsSchema = z.object({
  items: z.array(z.object({
    transactionId: z.string(),
    kind: transactionKind,
    amountCents: cents,
    occurredAt: z.string(),
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

export interface WalletTransport {
  readonly loadSummary: () => Promise<WalletLoad<WalletSummary>>;
  /** `before` is the previous page's `nextCursor`. */
  readonly loadTransactions: (before?: string) => Promise<WalletLoad<WalletTransactionsPage>>;
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

async function getJson<T>(url: string, schema: z.ZodType<T>): Promise<WalletLoad<T>> {
  let token: string | undefined;
  try {
    const { data, error } = await createClient().auth.getSession();
    if (error) throw error;
    token = data.session?.access_token;
  } catch {
    return { status: "error", code: "AUTH_UNAVAILABLE", message: "We couldn't check your sign-in. Please try again." };
  }
  if (!token) return { status: "error", code: "UNAUTHENTICATED", message: WALLET_ERROR_MESSAGES.UNAUTHENTICATED! };

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
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
  loadSummary: () => getJson(WALLET_URL, walletSummarySchema),
  loadTransactions: (before) => {
    const params = new URLSearchParams({ limit: String(TRANSACTIONS_PAGE_SIZE) });
    if (before !== undefined) params.set("before", before);
    return getJson(`${WALLET_TRANSACTIONS_URL}?${params}`, transactionsSchema);
  },
};
