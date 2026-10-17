import type Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";
import { parseTopUpAmount } from "@/app/wallet/top-up-amount";
import { readPublishableKey } from "@/app/wallet/top-up-transport";
import { StripeWalletTopUps } from "@/app/wallet/stripe-top-up-intents";
import { TopUpUnavailableError } from "@/app/wallet/wallet-api-unavailable";
import { walletErrorResponse } from "@/app/wallet/wallet-response";

describe("parseTopUpAmount", () => {
  test.each([
    ["20", 2000],
    ["20.5", 2050],
    ["20.50", 2050],
    ["S$20.05", 2005],
    [" 1000 ", 100_000],
    ["1", 100],
  ] as const)("reads %j as integer cents", (text, cents) => {
    // Act
    const amount = parseTopUpAmount(text);

    // Assert
    expect(amount).toEqual({ status: "valid", cents });
  });

  test("keeps cents exact where floating point would not (0.29 × 100 = 28.999…)", () => {
    // Act & Assert
    expect(parseTopUpAmount("1.29")).toEqual({ status: "valid", cents: 129 });
    expect(parseTopUpAmount("4.35")).toEqual({ status: "valid", cents: 435 });
  });

  test.each(["", "abc", "20.555", "-5", "1e3", "20,00", "0.99", "1000.01"])("rejects %j", (text) => {
    // Act & Assert
    expect(parseTopUpAmount(text).status).toBe("invalid");
  });
});

describe("StripeWalletTopUps", () => {
  test("creates a PayNow intent marked as a top-up for this user's wallet", async () => {
    // Arrange
    const { stripe, create } = fakeStripe();

    // Act
    const result = await new StripeWalletTopUps(stripe).createIntent(request("user-a", "key-1"));

    // Assert
    expect(create).toHaveBeenCalledWith(
      {
        amount: 2000,
        currency: "sgd",
        payment_method_types: ["paynow"],
        metadata: { purpose: "wallet_top_up", wallet_id: "wallet-user-a", user_id: "user-a" },
      },
      { idempotencyKey: '["UC1-05:top-up-intent","user-a","key-1"]' },
    );
    expect(result).toEqual({
      paymentIntentId: "pi_1",
      clientSecret: "pi_1_secret_x",
      amountCents: 2000,
      currency: "SGD",
      status: "requires_payment_method",
    });
  });

  test("gives two users who choose the same key different Stripe idempotency keys", async () => {
    // Arrange
    const { stripe, create } = fakeStripe();

    // Act
    await new StripeWalletTopUps(stripe).createIntent(request("user-a", "same-key"));
    await new StripeWalletTopUps(stripe).createIntent(request("user-b", "same-key"));

    // Assert
    const keys = create.mock.calls.map(([, options]) => options.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
  });

  test("refuses an intent without a client secret instead of inventing one", async () => {
    // Arrange
    const { stripe } = fakeStripe(null);

    // Act & Assert
    await expect(new StripeWalletTopUps(stripe).createIntent(request("user-a", "key-1"))).rejects.toThrow("client secret");
  });
});

describe("top-up configuration", () => {
  test("answers 503 TOP_UP_UNAVAILABLE without Stripe keys, while wallet reads keep working", async () => {
    // Act
    const response = walletErrorResponse(new TopUpUnavailableError());

    // Assert
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("TOP_UP_UNAVAILABLE");
  });

  test("offers top-ups only with a test-mode publishable key", () => {
    // Act & Assert
    expect(readPublishableKey("pk_test_abc")).toBe("pk_test_abc");
    expect(readPublishableKey("pk_live_abc")).toBeUndefined();
    expect(readPublishableKey(undefined)).toBeUndefined();
  });
});

function request(userId: string, idempotencyKey: string) {
  return { userId, walletId: `wallet-${userId}`, amountCents: 2000, idempotencyKey };
}

function fakeStripe(clientSecret: string | null = "pi_1_secret_x") {
  const create = vi.fn<
    (params: { amount: number }, options: { idempotencyKey: string }) => Promise<object>
  >(async (params) => ({
    id: "pi_1",
    client_secret: clientSecret,
    amount: params.amount,
    status: "requires_payment_method",
  }));
  return { stripe: { paymentIntents: { create } } as unknown as Stripe, create };
}
