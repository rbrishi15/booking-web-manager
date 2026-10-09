import { beforeEach, describe, expect, test, vi } from "vitest";
import { DomainError } from "@/domain";
import { WalletApiUnavailableError } from "@/app/wallet/wallet-api-unavailable";

const mocks = vi.hoisted(() => ({
  dependencies: vi.fn(),
  authenticate: vi.fn(),
  getWalletSummary: vi.fn(),
  listTransactions: vi.fn(),
  createTopUpIntent: vi.fn(),
}));

vi.mock("@/app/wallet/server-dependencies", () => ({
  getWalletDependencies: mocks.dependencies,
}));

import { GET as getWallet } from "@/app/api/wallet/route";
import { GET as listTransactionsRoute } from "@/app/api/wallet/transactions/route";
import { POST as topUpRoute } from "@/app/api/wallet/top-up/route";

const userId = "11111111-1111-4111-8111-111111111111";
const walletId = "22222222-2222-4222-8222-222222222222";

const mockSummary = {
  walletId,
  userId,
  availableBalanceCents: 10000,
  heldBalanceCents: 1500,
  currency: "SGD" as const,
  activeHolds: [
    {
      holdId: "33333333-3333-4333-8333-333333333333",
      sessionId: "44444444-4444-4444-8444-444444444444",
      heldCents: 1500,
      originalCents: 1500,
      createdAt: "2026-10-09T10:00:00.000Z",
      venueName: "Kallang Tennis Centre",
      sport: "Tennis",
      startAt: "2026-10-12T18:00:00.000Z",
    },
  ],
};

const mockTransactionsResult = {
  items: [
    {
      transactionId: "55555555-5555-4555-8555-555555555555",
      kind: "TOP_UP" as const,
      amountCents: 5000,
      occurredAt: "2026-10-09T12:00:00.000Z",
      idempotencyKey: "topup-key-1",
      externalReference: "pi_12345",
      holdId: null,
      payoutId: null,
    },
  ],
  nextCursor: null,
};

const mockTopUpResult = {
  paymentIntentId: "pi_test_123456",
  clientSecret: "pi_test_123456_secret",
  amountCents: 5000,
  currency: "SGD" as const,
  status: "requires_action",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(userId);
  mocks.getWalletSummary.mockResolvedValue(mockSummary);
  mocks.listTransactions.mockResolvedValue(mockTransactionsResult);
  mocks.createTopUpIntent.mockResolvedValue(mockTopUpResult);

  mocks.dependencies.mockResolvedValue({
    authenticate: mocks.authenticate,
    getWalletSummary: mocks.getWalletSummary,
    listTransactions: mocks.listTransactions,
    createTopUpIntent: mocks.createTopUpIntent,
  });
});

describe("GET /api/wallet", () => {
  test("returns wallet summary for authenticated user with no-store cache control", async () => {
    const request = new Request("http://localhost/api/wallet", {
      headers: { authorization: "Bearer valid-token" },
    });

    const response = await getWallet(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(mockSummary);
    expect(mocks.getWalletSummary).toHaveBeenCalledWith(userId);
  });

  test("returns 401 UNAUTHENTICATED when unauthenticated", async () => {
    mocks.authenticate.mockResolvedValue(null);

    const request = new Request("http://localhost/api/wallet");
    const response = await getWallet(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(mocks.getWalletSummary).not.toHaveBeenCalled();
  });

  test("returns 403 INACTIVE_ACCOUNT when account is deactivated", async () => {
    mocks.authenticate.mockRejectedValue(
      new DomainError("INACTIVE_ACCOUNT", "Account is deactivated"),
    );

    const request = new Request("http://localhost/api/wallet", {
      headers: { authorization: "Bearer inactive-token" },
    });
    const response = await getWallet(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "INACTIVE_ACCOUNT" },
    });
  });

  test("returns 404 NOT_FOUND when wallet does not exist", async () => {
    mocks.getWalletSummary.mockRejectedValue(
      new DomainError("NOT_FOUND", "Wallet was not found"),
    );

    const request = new Request("http://localhost/api/wallet", {
      headers: { authorization: "Bearer valid-token" },
    });
    const response = await getWallet(request);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  test("returns 503 WALLET_API_UNAVAILABLE when dependencies fail setup", async () => {
    mocks.getWalletSummary.mockRejectedValue(new WalletApiUnavailableError());

    const request = new Request("http://localhost/api/wallet", {
      headers: { authorization: "Bearer valid-token" },
    });
    const response = await getWallet(request);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "WALLET_API_UNAVAILABLE" },
    });
  });
});

describe("GET /api/wallet/transactions", () => {
  test("returns transactions with default query params", async () => {
    const request = new Request("http://localhost/api/wallet/transactions", {
      headers: { authorization: "Bearer valid-token" },
    });

    const response = await listTransactionsRoute(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(mockTransactionsResult);
    expect(mocks.listTransactions).toHaveBeenCalledWith(userId, {
      limit: undefined,
      before: undefined,
    });
  });

  test("parses limit and before query parameters", async () => {
    const request = new Request(
      "http://localhost/api/wallet/transactions?limit=25&before=2026-10-09T10:00:00.000Z",
      { headers: { authorization: "Bearer valid-token" } },
    );

    const response = await listTransactionsRoute(request);
    expect(response.status).toBe(200);
    expect(mocks.listTransactions).toHaveBeenCalledWith(userId, {
      limit: 25,
      before: new Date("2026-10-09T10:00:00.000Z"),
    });
  });

  test("returns 400 INVALID_REQUEST for invalid limit query parameter", async () => {
    const request = new Request(
      "http://localhost/api/wallet/transactions?limit=-5",
      { headers: { authorization: "Bearer valid-token" } },
    );

    const response = await listTransactionsRoute(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  test("returns 400 INVALID_REQUEST for invalid before date parameter", async () => {
    const request = new Request(
      "http://localhost/api/wallet/transactions?before=not-a-date",
      { headers: { authorization: "Bearer valid-token" } },
    );

    const response = await listTransactionsRoute(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });
});

describe("POST /api/wallet/top-up", () => {
  test("creates a top-up intent successfully with 201 status", async () => {
    const request = new Request("http://localhost/api/wallet/top-up", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amountCents: 5000,
        idempotencyKey: "test-idempotency-key",
      }),
    });

    const response = await topUpRoute(request);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(mockTopUpResult);
    expect(mocks.createTopUpIntent).toHaveBeenCalledWith(userId, {
      amountCents: 5000,
      idempotencyKey: "test-idempotency-key",
    });
  });

  test("returns 400 INVALID_REQUEST when request body is malformed JSON", async () => {
    const request = new Request("http://localhost/api/wallet/top-up", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: "{ not valid json",
    });

    const response = await topUpRoute(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  test("returns 400 INVALID_REQUEST when idempotencyKey is missing", async () => {
    const request = new Request("http://localhost/api/wallet/top-up", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ amountCents: 5000 }),
    });

    const response = await topUpRoute(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
  });

  test("returns 422 INVALID_INPUT when amount is below SGD 1.00 (< 100 cents)", async () => {
    const request = new Request("http://localhost/api/wallet/top-up", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amountCents: 50,
        idempotencyKey: "test-idempotency-key",
      }),
    });

    const response = await topUpRoute(request);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });

  test("returns 422 INVALID_INPUT when amount exceeds SGD 1,000.00 (> 100000 cents)", async () => {
    const request = new Request("http://localhost/api/wallet/top-up", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        amountCents: 200000,
        idempotencyKey: "test-idempotency-key",
      }),
    });

    const response = await topUpRoute(request);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
  });
});
