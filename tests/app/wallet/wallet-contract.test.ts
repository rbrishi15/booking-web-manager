import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createClient } from "@/lib/supabase/client";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn() }));
vi.mock("@/app/wallet/server-dependencies", () => ({ getWalletDependencies: mocks.dependencies }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { GET as getWallet } from "@/app/api/wallet/route";
import { GET as listTransactions } from "@/app/api/wallet/transactions/route";
import { walletTransport } from "@/app/wallet/wallet-transport";

const userId = "11111111-1111-4111-8111-111111111111";

/** Sends the page's requests to the real wallet route handlers instead of the network. */
function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(new URL(String(input), "http://localhost"), init);
  return new URL(request.url).pathname === "/api/wallet/transactions" ? listTransactions(request) : getWallet(request);
}

describe("UC1-05 wallet page against the wallet API routes", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue({
      auth: { getSession: async () => ({ data: { session: { access_token: "player-token" } }, error: null }) },
    } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", vi.fn(routeFetch));
    mocks.dependencies.mockResolvedValue({
      authenticate: async () => userId,
      getWalletSummary: async () => ({
        walletId: "22222222-2222-4222-8222-222222222222", userId,
        availableBalanceCents: 10000, heldBalanceCents: 1500, currency: "SGD",
        activeHolds: [{
          holdId: "33333333-3333-4333-8333-333333333333", sessionId: "44444444-4444-4444-8444-444444444444",
          heldCents: 1500, originalCents: 1500, createdAt: "2026-10-09T10:00:00.000Z",
          venueName: "Kallang Tennis Centre", sport: "Tennis", startAt: "2026-10-12T18:00:00.000Z",
        }],
      }),
      listTransactions: async () => ({
        items: [{
          transactionId: "55555555-5555-4555-8555-555555555555", kind: "TOP_UP", amountCents: 5000,
          occurredAt: "2026-10-09T12:00:00.000Z", idempotencyKey: "topup-key-1",
          externalReference: "pi_12345", holdId: null, payoutId: null,
        }],
        nextCursor: "2026-10-09T12:00:00.000Z",
      }),
      createTopUpIntent: async () => { throw new Error("not used"); },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  test("reads the summary the wallet route returns", async () => {
    // Act
    const result = await walletTransport.loadSummary();

    // Assert
    expect(result).toMatchObject({ status: "ready", data: { availableBalanceCents: 10000, heldBalanceCents: 1500 } });
  });

  test("reads a transactions page and passes its cursor back to the route", async () => {
    // Act
    const first = await walletTransport.loadTransactions();
    const next = await walletTransport.loadTransactions("2026-10-09T12:00:00.000Z");

    // Assert
    expect(first).toMatchObject({ status: "ready", data: { items: [{ kind: "TOP_UP", amountCents: 5000 }], nextCursor: "2026-10-09T12:00:00.000Z" } });
    expect(next.status).toBe("ready");
  });
});
