import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createWalletDependencies } from "@/use-case-config/wallet";
import { TopUpUnavailableError, WalletApiUnavailableError } from "@/app/wallet/wallet-api-unavailable";

const driver = vi.hoisted(() => ({ query: vi.fn(), getPool: vi.fn(), createPoolProvider: vi.fn() }));
vi.mock("@/lib/database/postgres-pool", () => ({ createPostgresPoolProvider: driver.createPoolProvider }));

beforeEach(() => {
  vi.resetAllMocks();
  driver.getPool.mockReturnValue({ query: driver.query });
  driver.createPoolProvider.mockReturnValue(driver.getPool);
  driver.query.mockImplementation(async (statement: string, values: unknown[]) => {
    if (statement.includes("from wallets")) return { rows: [{ wallet_id: `wallet-${values[0]}` }] };
    if (statement.includes("from wallet_balances")) return { rows: [{ wallet_id: values[0], available_cents: "2500" }] };
    return { rows: [] };
  });
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:55322/postgres");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

test("shares lazy infrastructure while resolving each caller's wallet independently", async () => {
  const dependencies = createWalletDependencies();
  expect(driver.getPool).not.toHaveBeenCalled();
  for (const userId of ["first", "second"]) {
    expect(await dependencies.walletSummary.forUser(userId)).toEqual({
      walletId: `wallet-${userId}`, userId, availableBalanceCents: 2500,
      heldBalanceCents: 0, activeHolds: [], currency: "SGD",
    });
    expect(driver.query).toHaveBeenLastCalledWith(expect.stringContaining("from hold_balances"), [`wallet-${userId}`]);
  }
  expect(driver.createPoolProvider).toHaveBeenCalledOnce();
});

test("missing Stripe settings disable top-up before reading storage, leaving history available", async () => {
  const dependencies = createWalletDependencies();
  await expect(dependencies.walletTopUp.forUser("user-a", { amountCents: 1000, idempotencyKey: "retry" }))
    .rejects.toBeInstanceOf(TopUpUnavailableError);
  expect(driver.getPool).not.toHaveBeenCalled();
  expect(await dependencies.walletTransactions.forUser("user-a", {})).toEqual({ items: [], nextCursor: null });
  expect(driver.query).toHaveBeenLastCalledWith(expect.stringContaining("from ledger_entries"), ["wallet-user-a", null, 50]);
});

test("missing database settings expose unavailable capabilities without opening infrastructure", async () => {
  vi.stubEnv("DATABASE_URL", "");
  const dependencies = createWalletDependencies();
  await expect(dependencies.walletSummary.forUser("user-a")).rejects.toBeInstanceOf(WalletApiUnavailableError);
  await expect(dependencies.walletTransactions.forUser("user-a", {})).rejects.toBeInstanceOf(WalletApiUnavailableError);
  await expect(dependencies.walletTopUp.forUser("user-a", { amountCents: 1000, idempotencyKey: "retry" }))
    .rejects.toBeInstanceOf(WalletApiUnavailableError);
  expect(driver.createPoolProvider).not.toHaveBeenCalled();
});
