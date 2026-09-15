import { describe, test } from "vitest";

// Owner: Yajie (Wyjessie) — /app/commit
describe("UC2-05 Withdraw from Session", () => {
  test.todo("full refund when withdrawing more than 30h before session start");
  test.todo(
    "at 30h or less, moves to awaiting_replacement instead of an immediate refund",
  );
  test.todo(
    "forfeits (credits the booker) if no replacement is found before session start",
  );
  test.todo(
    "a replacement found before session start resolves out of awaiting_replacement without forfeiture",
  );
});
