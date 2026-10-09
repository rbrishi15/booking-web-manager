import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { walletTransport } from "@/app/wallet/wallet-transport";
import { createClient } from "@/lib/supabase/client";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

const getSession = vi.fn();
const fetcher = vi.fn<typeof fetch>();

const summary = {
  walletId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  availableBalanceCents: 2500,
  heldBalanceCents: 1250,
  currency: "SGD",
  activeHolds: [{
    holdId: "33333333-3333-4333-8333-333333333333", sessionId: "44444444-4444-4444-8444-444444444444",
    heldCents: 1250, originalCents: 1250, createdAt: "2045-04-01T10:00:00.000Z",
    venueName: "Bishan Sports Hall", sport: "Badminton", startAt: "2045-04-02T10:00:00.000Z",
  }],
};

describe("UC1-05 wallet transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: "player-token" } }, error: null });
    vi.mocked(createClient).mockReturnValue({ auth: { getSession } } as unknown as ReturnType<typeof createClient>);
    vi.stubGlobal("fetch", fetcher);
  });

  afterEach(() => vi.unstubAllGlobals());

  test("reads the wallet summary with the bearer token and no caching", async () => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json(summary));

    // Act
    const result = await walletTransport.loadSummary();

    // Assert
    expect(result).toEqual({ status: "ready", data: expect.objectContaining({ availableBalanceCents: 2500, heldBalanceCents: 1250 }) });
    expect(fetcher).toHaveBeenCalledWith("/api/wallet", expect.objectContaining({ headers: { Authorization: "Bearer player-token" }, cache: "no-store" }));
  });

  test("asks for the first page of transactions, then the next page from the cursor", async () => {
    // Arrange
    const page = { items: [{ transactionId: "t1", kind: "TOP_UP", amountCents: 5000, occurredAt: "2045-04-01T09:00:00.000Z" }], nextCursor: "2045-04-01T09:00:00.000Z" };
    fetcher.mockResolvedValue(Response.json(page));

    // Act
    const first = await walletTransport.loadTransactions();
    await walletTransport.loadTransactions("2045-04-01T09:00:00.000Z");

    // Assert
    expect(first).toEqual({ status: "ready", data: page });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/wallet/transactions?limit=20");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/wallet/transactions?limit=20&before=2045-04-01T09%3A00%3A00.000Z");
  });

  test("reports a signed-out user without calling the API", async () => {
    // Arrange
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    // Act & Assert
    expect(await walletTransport.loadSummary()).toMatchObject({ status: "error", code: "UNAUTHENTICATED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test.each([
    [503, "WALLET_API_UNAVAILABLE", "temporarily unavailable"],
    [403, "INACTIVE_ACCOUNT", "can't use a wallet"],
    [404, "NOT_FOUND", "couldn't find your wallet"],
  ])("shows a player-facing message for %s %s", async (status, code, text) => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json({ error: { code, message: "internal wording" } }, { status }));

    // Act
    const result = await walletTransport.loadSummary();

    // Assert
    expect(result).toMatchObject({ status: "error", code });
    expect(result.status === "error" && result.message).toContain(text);
  });

  test.each([
    ["a fractional amount", { ...summary, availableBalanceCents: 12.5 }],
    ["a missing balance", { ...summary, availableBalanceCents: undefined }],
  ])("rejects a summary with %s instead of showing a wrong balance", async (_name, body) => {
    // Arrange
    fetcher.mockResolvedValueOnce(Response.json(body));

    // Act & Assert
    expect(await walletTransport.loadSummary()).toMatchObject({ status: "error", code: "UNEXPECTED_RESPONSE" });
  });

  test("treats a network failure or non-JSON reply as a load error", async () => {
    // Arrange
    fetcher.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response("<html>Not found</html>", { status: 404 }));

    // Act & Assert
    expect(await walletTransport.loadSummary()).toMatchObject({ status: "error", code: "NETWORK_ERROR" });
    expect(await walletTransport.loadSummary()).toMatchObject({ status: "error" });
  });
});
