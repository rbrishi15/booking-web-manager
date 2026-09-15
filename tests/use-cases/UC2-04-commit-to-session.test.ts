import { describe, test } from "vitest";

// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-04 Commit to Session", () => {
  test.todo(
    "locks the participant's share and creates the commitment row in one transaction",
  );
  test.todo(
    "commits a slot only when capacity remains, otherwise adds to the waitlist FIFO on joined_at",
  );
  test.todo(
    "rejects a commit when the wallet's available balance is insufficient",
  );
  test.todo(
    "a repeated request with the same idempotency key returns the original result without re-locking funds",
  );

  // The priority test — see CLAUDE.md "Testing". Filtered by `npm run test:concurrency`.
  test.todo(
    "concurrency: 20 concurrent commits on an 8-slot session — exactly 8 succeed, 12 waitlist, total locked = 8 × share",
  );
});
