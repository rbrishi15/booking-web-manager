import { expect, test, vi } from "vitest";
import { PostgresSessionParticipantNames } from "@/lib/sessions/postgres-session-participant-names";
import type { SqlExecutor } from "@/lib/money/sql";

test("maps profile names, anonymised accounts and unnamed players in the SQL transaction", async () => {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValue([
    { user_id: "alice", account_status: "ACTIVE", display_name: " Alice " },
    { user_id: "ben", account_status: "INACTIVE", display_name: "Prior name" },
    { user_id: "cara", account_status: "ACTIVE", display_name: null },
    { user_id: "dana", account_status: "ACTIVE", display_name: " " },
  ]);
  const names = await new PostgresSessionParticipantNames({ query: query as SqlExecutor["query"] }).displayNames(["alice", "ben", "cara", "dana"]);
  expect([...names]).toEqual([["alice", "Alice"], ["ben", "Deleted user"], ["cara", "Unnamed player"], ["dana", "Unnamed player"]]);
  expect(query.mock.calls[0]?.[1]).toEqual([["alice", "ben", "cara", "dana"]]);
});

test("skips empty lists and rejects a missing profile instead of inventing one", async () => {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValue([]);
  const reader = new PostgresSessionParticipantNames({ query: query as SqlExecutor["query"] });
  expect(await reader.displayNames([])).toEqual(new Map());
  expect(query).not.toHaveBeenCalled();
  await expect(reader.displayNames(["missing"])).rejects.toMatchObject({ name: "SessionPersistenceError" });
});

test("distinguishes malformed stored profiles from SQL failures", async () => {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValueOnce([{ user_id: "alice", account_status: "UNKNOWN", display_name: "Alice" }]);
  const reader = new PostgresSessionParticipantNames({ query: query as SqlExecutor["query"] });
  await expect(reader.displayNames(["alice"])).rejects.toMatchObject({ name: "SessionPersistenceError" });
  const failure = new Error("SQL failed");
  query.mockRejectedValueOnce(failure);
  await expect(reader.displayNames(["alice"])).rejects.toBe(failure);
});
