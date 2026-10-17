import { describe, expect, test, vi } from "vitest";
import type { PayoutDependencies } from "@/app/payouts/payout-dependencies";
import { PayoutProviderError } from "@/use-cases/payouts/SetUpPayoutAccount";

const mocks = vi.hoisted(() => ({ dependencies: vi.fn() }));
vi.mock("@/app/payouts/payout-server-dependencies", () => ({
  getPayoutDependencies: mocks.dependencies,
}));

import { GET as listSessions } from "@/app/api/payouts/sessions/route";
import { POST as withdraw } from "@/app/api/payouts/withdraw/route";

const bookerId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

describe("UC1-08 payout routes", () => {
  test("POST /api/payouts/withdraw takes the booker from authentication and the amount from the server", async () => {
    // Arrange
    const forBooker = vi.fn(async () => ({
      kind: "PAID" as const,
      payoutId: "33333333-3333-4333-8333-333333333333",
      amountCents: 1000,
      bankPayout: "STANDARD" as const,
    }));
    mocks.dependencies.mockResolvedValue(dependencies({ withdrawals: { forBooker } }));

    // Act
    const response = await withdraw(post({ sessionId, idempotencyKey: "k-1", amountCents: 999_999, bookerId: "someone-else" }));

    // Assert
    expect(response.status).toBe(200);
    expect(forBooker).toHaveBeenCalledWith({ bookerId, sessionId, idempotencyKey: "k-1", method: "STANDARD" });
    expect((await response.json()).amountCents).toBe(1000);
  });

  test("rejects a withdrawal without a valid session ID", async () => {
    // Arrange
    mocks.dependencies.mockResolvedValue(dependencies({}));

    // Act
    const response = await withdraw(post({ sessionId: "not-a-uuid", idempotencyKey: "k-1" }));

    // Assert
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  test("rejects a body that is not JSON", async () => {
    // Arrange
    mocks.dependencies.mockResolvedValue(dependencies({}));

    // Act
    const response = await withdraw(new Request("https://app.test/api/payouts/withdraw", { method: "POST", body: "{" }));

    // Assert
    expect(response.status).toBe(400);
  });

  test("answers 502 for an unclear Stripe failure, which the client retries with the same key", async () => {
    // Arrange
    const forBooker = vi.fn(async () => {
      throw new PayoutProviderError("socket hang up");
    });
    mocks.dependencies.mockResolvedValue(dependencies({ withdrawals: { forBooker } }));

    // Act
    const response = await withdraw(post({ sessionId, idempotencyKey: "k-1" }));

    // Assert
    expect(response.status).toBe(502);
  });

  test("reports a body-read failure as an opaque server error before invoking the use case", async () => {
    const forBooker = vi.fn();
    mocks.dependencies.mockResolvedValue(dependencies({ withdrawals: { forBooker } }));
    const request = post({ sessionId, idempotencyKey: "k-1" });
    vi.spyOn(request, "json").mockRejectedValue(new Error("private stream failure"));

    const response = await withdraw(request);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
    expect(forBooker).not.toHaveBeenCalled();
  });

  test("GET /api/payouts/sessions lists the booker's payable sessions with ISO dates", async () => {
    // Arrange
    const forBooker = vi.fn(async () => [
      {
        sessionId,
        venueName: "Kallang Tennis Hub",
        sport: "Tennis",
        startAt: new Date("2026-10-10T10:00:00Z"),
        status: "AWAITING_PAYOUT" as const,
        amountCents: 1000,
      },
    ]);
    mocks.dependencies.mockResolvedValue(dependencies({ sessionPayouts: { forBooker } }));

    // Act
    const response = await listSessions(new Request("https://app.test/api/payouts/sessions"));

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          sessionId,
          venueName: "Kallang Tennis Hub",
          sport: "Tennis",
          startAt: "2026-10-10T10:00:00.000Z",
          status: "AWAITING_PAYOUT",
          amountCents: 1000,
        },
      ],
    });
    expect(forBooker).toHaveBeenCalledWith(bookerId);
  });
});

function post(body: object): Request {
  return new Request("https://app.test/api/payouts/withdraw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides: Partial<PayoutDependencies>): PayoutDependencies {
  const unused = async (): Promise<never> => {
    throw new Error("not used in this test");
  };
  return {
    authenticate: async () => bookerId,
    payoutSetup: { status: unused, start: unused },
    sessionPayouts: { forBooker: unused },
    withdrawals: { forBooker: unused },
    ...overrides,
  };
}
