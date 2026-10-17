import { describe, expect, test, vi } from "vitest";
import { LedgerError } from "@/lib/money/errors";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";
import { PostgresWalletReader } from "@/lib/wallet/postgres-wallet-reader";

const createdAt = new Date("2026-10-17T03:00:00Z");
const hold = { hold_id: "hold-a", session_id: "session-a", held_cents: "350",
  original_cents: "500", created_at: createdAt, venue_name: "Sports Hall", sport: "Badminton", start_at: createdAt };

function setup(rows: readonly SqlRow[]) {
  const query = vi.fn<(statement: string, values?: readonly unknown[]) => Promise<readonly SqlRow[]>>().mockResolvedValue(rows);
  const sql: SqlExecutor = {
    query: async <Row extends SqlRow>(statement: string, values?: readonly unknown[]) =>
      await query(statement, values) as readonly Row[],
  };
  return { query, reader: new PostgresWalletReader(sql) };
}

describe("Postgres wallet reads", () => {
  test("maps integer-cent holds and session details scoped to the wallet", async () => {
    const { reader, query } = setup([hold]);
    const result = await reader.listActiveHolds("wallet-a");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("where h.wallet_id = $1 and h.held_cents > 0"), ["wallet-a"]);
    expect(result[0]).toMatchObject({ holdId: "hold-a", sessionId: "session-a", venueName: "Sports Hall", createdAt });
    expect(result[0]!.heldAmount.toCents()).toBe(350);
    expect(result[0]!.originalAmount.toCents()).toBe(500);
  });

  test("retains a hold when joined session details are absent", async () => {
    const { reader } = setup([{ ...hold, venue_name: null, sport: null, start_at: null }]);
    expect((await reader.listActiveHolds("wallet-a"))[0]).toMatchObject({
      holdId: "hold-a", venueName: undefined, sport: undefined, startAt: undefined,
    });
  });

  test.each(["9007199254740993", "3.5", null])("rejects lossy or missing stored cents %s", async (held_cents) => {
    const { reader } = setup([{ ...hold, held_cents }]);
    await expect(reader.listActiveHolds("wallet-a")).rejects.toMatchObject({
      name: "LedgerError", code: "INVARIANT_VIOLATED",
    });
  });

  test.each([
    ["hold_id", null],
    ["session_id", ""],
    ["created_at", new Date("invalid")],
    ["created_at", null],
    ["venue_name", 123],
    ["sport", ""],
    ["start_at", new Date("invalid")],
  ] as const)("reports malformed stored %s as a ledger invariant failure", async (column, value) => {
    const { reader } = setup([{ ...hold, [column]: value }]);
    await expect(reader.listActiveHolds("wallet-a")).rejects.toMatchObject({
      name: "LedgerError", code: "INVARIANT_VIOLATED",
    });
  });

  test.each([
    ["40001", "SERIALISATION_FAILURE"],
    ["40P01", "DEADLOCK"],
    ["23503", "UNKNOWN_ACCOUNT"],
  ])("translates database failure %s consistently with inherited reads", async (sqlState, code) => {
    const { reader, query } = setup([]);
    const failure = Object.assign(new Error("database failure"), { code: sqlState });
    query.mockRejectedValue(failure);
    await expect(reader.listActiveHolds("wallet-a")).rejects.toMatchObject({
      name: "LedgerError", code, cause: failure,
    });
  });

  test("preserves an existing ledger failure", async () => {
    const { reader, query } = setup([]);
    const failure = new LedgerError("INVARIANT_VIOLATED", "stored state is inconsistent");
    query.mockRejectedValue(failure);
    await expect(reader.listActiveHolds("wallet-a")).rejects.toBe(failure);
  });

  test("does not turn query failure into an empty wallet", async () => {
    const { reader, query } = setup([]);
    const failure = new Error("database unavailable");
    query.mockRejectedValue(failure);
    await expect(reader.listActiveHolds("wallet-a")).rejects.toBe(failure);
  });
});
