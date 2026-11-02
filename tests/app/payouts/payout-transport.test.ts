import { afterEach, expect, test, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { declinedWithdrawalMessage, payoutTransport } from "@/app/payouts/payout-transport";

afterEach(() => vi.unstubAllGlobals());

test("accepts a recovered paid receipt without a bank payout method", async () => {
  const fetcher = vi.fn(async () => Response.json({ kind: "PAID", payoutId: "payout-1", amountCents: 1000 }));
  vi.stubGlobal("fetch", fetcher);

  const result = await payoutTransport.withdraw("session-1", "original-key", "INSTANT");

  expect(result).toEqual({ status: "ready", data: { kind: "PAID", amountCents: 1000 } });
  expect(fetcher).toHaveBeenCalledWith("/api/payouts/withdraw", expect.objectContaining({
    method: "POST", body: JSON.stringify({ sessionId: "session-1", idempotencyKey: "original-key", method: "INSTANT" }),
  }));
});

test("keeps Stripe's decline reason so the booker sees why no money moved", async () => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ kind: "DECLINED", payoutId: "payout-1", reason: "balance_insufficient" })));

  const result = await payoutTransport.withdraw("session-1", "key", "STANDARD");

  expect(result).toEqual({ status: "ready", data: { kind: "DECLINED", reason: "balance_insufficient" } });
});

test.each([
  ["balance_insufficient", /still settling with Stripe.*No money moved/],
  ["account_invalid", /couldn't send this payout, and no money moved/],
  [undefined, /couldn't send this payout, and no money moved/],
])("explains a %s decline", (reason, message) => {
  expect(declinedWithdrawalMessage(reason)).toMatch(message);
});
