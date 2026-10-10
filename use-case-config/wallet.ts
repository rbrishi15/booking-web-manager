import { createHash } from "node:crypto";
import type { UUID } from "@/domain";
import { DomainError } from "@/domain";
import { readSessionServerSettings } from "@/app/sessions/server-environment";
import { WalletApiUnavailableError } from "@/app/wallet/wallet-api-unavailable";
import type {
  ActiveHoldItem,
  WalletApiDependencies,
  WalletSummary,
  WalletTransactionItem,
  WalletTransactionsResult,
  WalletTopUpRequest,
  WalletTopUpResult,
} from "@/app/wallet/dependencies";
import { createPostgresPoolProvider } from "@/lib/database/postgres-pool";
import { PostgresLedgerReader } from "@/lib/money/ledger-read-adapter";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";
import { createSupabaseSessionAuthenticator } from "@/lib/supabase/bearer-auth";
import { createSupabaseCookieSessionAuthenticator } from "@/lib/supabase/cookie-auth";
import { bearerOrLoginCookie } from "@/lib/supabase/request-authenticator";

interface HoldRow extends SqlRow {
  readonly hold_id: unknown;
  readonly session_id: unknown;
  readonly held_cents: unknown;
  readonly original_cents: unknown;
  readonly created_at: unknown;
  readonly venue_name: unknown;
  readonly sport: unknown;
  readonly start_at: unknown;
}

export function createWalletDependencies(): WalletApiDependencies {
  const settings = readSessionServerSettings();
  if (settings === undefined) {
    const unavailable = async (): Promise<never> => {
      throw new WalletApiUnavailableError();
    };
    return {
      authenticate: unavailable,
      getWalletSummary: unavailable,
      listTransactions: unavailable,
      createTopUpIntent: unavailable,
    };
  }

  const getPool = createPostgresPoolProvider(settings.databaseUrl);
  const sql: SqlExecutor = {
    query: async (text, values) => {
      const pool = getPool();
      const result = await pool.query(text, values ? [...values] : undefined);
      return result.rows;
    },
  };

  const reader = new PostgresLedgerReader(sql);
  // The wallet page reads with its login cookies; top-up (POST) still needs a bearer token.
  const authenticate = bearerOrLoginCookie(
    createSupabaseSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
    createSupabaseCookieSessionAuthenticator(settings.supabaseUrl, settings.supabaseAnonKey),
  );

  async function requireWalletId(userId: UUID): Promise<UUID> {
    const walletId = await reader.findWalletIdByUserId(userId);
    if (walletId === null) {
      throw new DomainError("NOT_FOUND", "Wallet was not found");
    }
    return walletId;
  }

  async function getWalletSummary(userId: UUID): Promise<WalletSummary> {
    const walletId = await requireWalletId(userId);
    const balance = await reader.getWalletBalance(walletId);

    const holdRows = await sql.query<HoldRow>(
      `select h.hold_id, h.session_id, h.held_cents, h.original_cents, h.created_at,
              s.venue_name, s.sport, s.start_at
         from hold_balances h
         left join sessions s on s.session_id = h.session_id
        where h.wallet_id = $1 and h.held_cents > 0
        order by h.created_at desc`,
      [walletId],
    );

    let totalHeldCents = 0;
    const activeHolds: ActiveHoldItem[] = holdRows.map((row) => {
      const heldCents = Number(row.held_cents);
      totalHeldCents += heldCents;
      return {
        holdId: String(row.hold_id),
        sessionId: String(row.session_id),
        heldCents,
        originalCents: Number(row.original_cents),
        createdAt: new Date(row.created_at as string | number | Date).toISOString(),
        venueName: row.venue_name ? String(row.venue_name) : undefined,
        sport: row.sport ? String(row.sport) : undefined,
        startAt: row.start_at
          ? new Date(row.start_at as string | number | Date).toISOString()
          : undefined,
      };
    });

    return {
      walletId,
      userId,
      availableBalanceCents: balance ? balance.availableBalance.toCents() : 0,
      heldBalanceCents: totalHeldCents,
      currency: "SGD",
      activeHolds,
    };
  }

  async function listTransactions(
    userId: UUID,
    query: { limit?: number; before?: Date },
  ): Promise<WalletTransactionsResult> {
    const walletId = await requireWalletId(userId);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);

    const txs = await reader.listWalletTransactions({
      walletId,
      limit,
      occurredBefore: query.before,
    });

    const items: WalletTransactionItem[] = txs.map((tx) => ({
      transactionId: tx.transactionId,
      kind: tx.kind,
      amountCents: tx.amount.toCents(),
      occurredAt: tx.occurredAt.toISOString(),
      idempotencyKey: tx.idempotencyKey,
      externalReference: tx.externalReference ?? null,
      holdId: tx.holdId ?? null,
      payoutId: tx.payoutId ?? null,
    }));

    const nextCursor =
      items.length === limit ? (items[items.length - 1]?.occurredAt ?? null) : null;

    return { items, nextCursor };
  }

  async function createTopUpIntent(
    userId: UUID,
    input: WalletTopUpRequest,
  ): Promise<WalletTopUpResult> {
    const walletId = await requireWalletId(userId);

    const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (stripeKey && !stripeKey.startsWith("mock")) {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(stripeKey);
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: "sgd",
          payment_method_types: ["paynow"],
          metadata: {
            wallet_id: walletId,
            user_id: userId,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );

      return {
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret ?? `${intent.id}_secret_test`,
        amountCents: input.amountCents,
        currency: "SGD",
        status: intent.status,
      };
    }

    // Deterministic test/simulation intent when running without live Stripe keys
    const hash = createHash("sha256")
      .update(`${walletId}:${input.idempotencyKey}`)
      .digest("hex")
      .slice(0, 24);
    const paymentIntentId = `pi_test_${hash}`;

    return {
      paymentIntentId,
      clientSecret: `${paymentIntentId}_secret_test`,
      amountCents: input.amountCents,
      currency: "SGD",
      status: "requires_action",
    };
  }

  return {
    authenticate,
    getWalletSummary,
    listTransactions,
    createTopUpIntent,
  };
}
