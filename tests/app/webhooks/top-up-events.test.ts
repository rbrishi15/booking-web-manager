import type Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";
import { paymentIntentSucceededHandler } from "@/app/api/webhooks/top-up-events";

describe("payment_intent.succeeded handler (UC1-05 top-up crediting)", () => {
  test("credits the wallet named in the metadata with the amount Stripe received", async () => {
    // Arrange
    const credits = { credit: vi.fn(async () => "CREDITED") };

    // Act
    await paymentIntentSucceededHandler(credits)(succeeded({ amount_received: 2050 }));

    // Assert
    expect(credits.credit).toHaveBeenCalledWith(
      { eventId: "evt_1", eventType: "payment_intent.succeeded" },
      {
        paymentReference: "pi_1",
        walletId: "22222222-2222-4222-8222-222222222222",
        amountCents: 2050,
        succeededAt: new Date(1_790_000_000 * 1000),
      },
    );
  });

  test("ignores PaymentIntents that are not wallet top-ups", async () => {
    // Arrange
    const credits = { credit: vi.fn() };

    // Act
    await paymentIntentSucceededHandler(credits)(succeeded({ metadata: { wallet_id: "w" } }));

    // Assert
    expect(credits.credit).not.toHaveBeenCalled();
  });

  test("ignores a top-up without a wallet", async () => {
    // Arrange
    const credits = { credit: vi.fn() };

    // Act
    await paymentIntentSucceededHandler(credits)(succeeded({ metadata: { purpose: "wallet_top_up" } }));

    // Assert
    expect(credits.credit).not.toHaveBeenCalled();
  });

  test("does not credit a payment in another currency, and logs it for review", async () => {
    // Arrange
    const credits = { credit: vi.fn() };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    // Act
    await paymentIntentSucceededHandler(credits)(succeeded({ currency: "usd" }));

    // Assert
    expect(credits.credit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  test("does not credit a zero amount", async () => {
    // Arrange
    const credits = { credit: vi.fn() };
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Act
    await paymentIntentSucceededHandler(credits)(succeeded({ amount_received: 0 }));

    // Assert
    expect(credits.credit).not.toHaveBeenCalled();
  });

  test("lets a crediting failure propagate, so the endpoint answers 500 and Stripe retries", async () => {
    // Arrange
    const credits = {
      credit: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };

    // Act & Assert
    await expect(paymentIntentSucceededHandler(credits)(succeeded({}))).rejects.toThrow("database unavailable");
  });

  test("ignores other event types", async () => {
    // Arrange
    const credits = { credit: vi.fn() };

    // Act
    await paymentIntentSucceededHandler(credits)({ ...succeeded({}), type: "payment_intent.created" } as Stripe.Event);

    // Assert
    expect(credits.credit).not.toHaveBeenCalled();
  });
});

function succeeded(intent: {
  amount_received?: number;
  currency?: string;
  metadata?: Record<string, string>;
}): Stripe.Event {
  return {
    id: "evt_1",
    object: "event",
    type: "payment_intent.succeeded",
    created: 1_790_000_000,
    data: {
      object: {
        id: "pi_1",
        object: "payment_intent",
        amount_received: intent.amount_received ?? 2000,
        currency: intent.currency ?? "sgd",
        metadata: intent.metadata ?? {
          purpose: "wallet_top_up",
          wallet_id: "22222222-2222-4222-8222-222222222222",
          user_id: "11111111-1111-4111-8111-111111111111",
        },
      },
    },
  } as unknown as Stripe.Event;
}
