import { describe, expect, test, vi } from "vitest";
import { PostgresUserReader } from "@/lib/sessions/postgres-user-reader";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";

const now = new Date("2026-10-03T00:00:00Z");

describe("PostgresUserReader", () => {
  test("hydrates email verification from the trusted email confirmation timestamp", async () => {
    const { reader } = scenario({ email_confirmed_at: now });

    const user = await reader.get("player");

    expect(user?.email?.toString()).toBe("player@example.com");
    expect(user?.emailVerified).toBe(true);
  });

  test("phone confirmation and user metadata cannot verify an email", async () => {
    const { reader } = scenario({
      email_confirmed_at: null,
      confirmed_at: now,
      phone_confirmed_at: now,
      user_metadata: { email_verified: true },
    });

    const user = await reader.get("player");

    expect(user?.emailVerified).toBe(false);
  });

  test("hydrates an active account without an email as unverified", async () => {
    const { reader } = scenario({ email: null, email_confirmed_at: null });

    const user = await reader.get("player");

    expect(user?.accountStatus).toBe("ACTIVE");
    expect(user?.email).toBeNull();
    expect(user?.emailVerified).toBe(false);
  });

  test("an empty email remains unverified despite a prior confirmation timestamp", async () => {
    const { reader } = scenario({ email: "", email_confirmed_at: now });

    const user = await reader.get("player");

    expect(user?.email).toBeNull();
    expect(user?.emailVerified).toBe(false);
  });

  test("rejects missing trusted confirmation state for an existing email", async () => {
    const { reader } = scenario({ email_confirmed_at: undefined });

    await expect(reader.get("player")).rejects.toMatchObject({ name: "SessionPersistenceError" });
  });
});

function scenario(overrides: SqlRow) {
  const profile: SqlRow = {
    user_id: "player",
    account_status: "ACTIVE",
    preferred_sports: [],
    preferred_regions: [],
    email: "player@example.com",
    email_confirmed_at: null,
    ...overrides,
  };
  const query = vi.fn<SqlExecutor["query"]>()
    .mockResolvedValueOnce([profile])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ wallet_id: "wallet-player", user_id: "player" }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([]);
  return { reader: new PostgresUserReader({ query: query as SqlExecutor["query"] }, { now: () => now }) };
}
