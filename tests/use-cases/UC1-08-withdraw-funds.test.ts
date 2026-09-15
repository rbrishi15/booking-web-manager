import { describe, test } from "vitest";

// Owner: Rishi (rbrishi15) — /app/payouts
describe("UC1-08 Withdraw Funds", () => {
  test.todo("transfers available balance out via standard payout");
  test.todo(
    "falls back to standard payout when instant payout eligibility fails",
  );
  test.todo("rejects withdrawal above the available (non-held) balance");
});
