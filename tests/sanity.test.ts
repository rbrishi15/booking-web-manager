import { describe, expect, test } from "vitest";

describe("repo scaffold", () => {
  test("test runner is wired up", () => {
    expect(true).toBe(true);
  });

  // Real test lives here once /app/commit and /domain expose the ledger lock —
  // see CLAUDE.md "Testing". Owner: Yajie + Harrison.
  test.todo(
    "concurrency: 20 concurrent commits on an 8-slot session — 8 succeed, 12 waitlist, total locked = 8 × share",
  );
});
