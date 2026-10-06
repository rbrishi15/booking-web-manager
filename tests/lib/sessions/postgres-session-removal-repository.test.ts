import { beforeEach, expect, test, vi } from "vitest";
import type { Session } from "@/domain";
import { PostgresSessionRemovalRepository } from "@/lib/sessions/postgres-session-removal-repository";
import type { SqlExecutor } from "@/lib/money/sql";
import { createTestSession, hoursBeforeSessionStart, readyBooker } from "../../domain/sessions/session/session-fixtures";

const reader = vi.hoisted(() => ({ get: vi.fn<(id: string) => Promise<Session | null>>() }));
vi.mock("@/lib/sessions/postgres-session-management-repository", () => ({
  PostgresSessionManagementRepository: vi.fn(function () { return { get: reader.get }; }),
}));
beforeEach(() => { reader.get.mockReset(); });

function scenario(initial = createTestSession({ committedUserIds: ["alice", "ben"] })) {
  reader.get.mockResolvedValue(initial);
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValue([]);
  return { initial, query, repository: new PostgresSessionRemovalRepository({ query: query as SqlExecutor["query"] }) };
}

test("reconciles complete financial history before returning a locked session", async () => {
  const { initial, query, repository } = scenario();
  expect(await repository.get("s")).toBe(initial);
  expect(reader.get).toHaveBeenCalledExactlyOnceWith("s");
  const [sql, values] = query.mock.calls[0]!;
  expect(values).toEqual(["s"]);
  expect(sql).toContain("full join hold_balances");
  expect(sql).toContain("b.original_cents <> h.amount_cents");
  expect(sql).toContain("b.held_cents <>");
  expect(sql).toContain("b.settled_kind::text is distinct from");
  expect(sql).toContain("b.wallet_id is distinct from h.wallet_id");
  expect(sql).toContain("b.holding_account_id is distinct from h.holding_account_id");
});

test("rejects contradictory projections without admitting the session for saving", async () => {
  const { initial, query, repository } = scenario();
  query.mockResolvedValueOnce([{ hold_id: "h-alice" }]);
  await expect(repository.get("s")).rejects.toMatchObject({ name: "SessionPersistenceError" });
  readyBooker().removeParticipant(initial, "p-alice", hoursBeforeSessionStart(5));
  await expect(repository.saveRemoval(initial, "p-alice")).rejects.toMatchObject({ name: "SessionPersistenceError" });
  expect(query).toHaveBeenCalledOnce();
});

test("keeps missing sessions and SQL errors distinct", async () => {
  const { query, repository } = scenario();
  reader.get.mockResolvedValueOnce(null);
  expect(await repository.get("missing")).toBeNull();
  expect(query).not.toHaveBeenCalled();
  const failure = new Error("SQL failed");
  query.mockRejectedValueOnce(failure);
  await expect(repository.get("s")).rejects.toBe(failure);
});

test("writes only the target status and refunded hold while retaining all replacement and session facts", async () => {
  const { initial, query, repository } = scenario();
  await repository.get("s");
  const time = hoursBeforeSessionStart(5);
  readyBooker().removeParticipant(initial, "p-alice", time);
  query.mockResolvedValueOnce([{ participation_id: "p-alice" }]).mockResolvedValueOnce([{ hold_id: "h-alice" }]);
  await repository.saveRemoval(initial, "p-alice");
  expect(query.mock.calls.slice(1).map((call) => call[1])).toEqual([["s", "p-alice"], ["h-alice", "p-alice", time]]);
  const writes = query.mock.calls.slice(1).map((call) => call[0]).join("\n");
  expect(writes).not.toMatch(/update sessions|replacement_mode|replacement_invitee_id|replaces_participation_id|list_position|queue_sequence/i);
  expect(writes).toContain("status = 'COMMITTED'");
  expect(writes).toContain("state = 'HELD'");
});

test.each(["unloaded", "unchanged", "multiple"] as const)("rejects an %s transition without issuing writes", async (kind) => {
  const { initial, query, repository } = scenario();
  if (kind !== "unloaded") await repository.get("s");
  if (kind !== "unchanged") readyBooker().removeParticipant(initial, "p-alice", hoursBeforeSessionStart(5));
  if (kind === "multiple") readyBooker().removeParticipant(initial, "p-ben", hoursBeforeSessionStart(5));
  query.mockClear();
  await expect(repository.saveRemoval(initial, "p-alice")).rejects.toMatchObject({ name: "SessionPersistenceError" });
  expect(query).not.toHaveBeenCalled();
});

test.each(["participation", "hold"] as const)("requires the %s update to match exactly one row", async (missing) => {
  const { initial, query, repository } = scenario();
  await repository.get("s");
  readyBooker().removeParticipant(initial, "p-alice", hoursBeforeSessionStart(5));
  if (missing === "hold") query.mockResolvedValueOnce([{ participation_id: "p-alice" }]);
  query.mockResolvedValueOnce([]);
  await expect(repository.saveRemoval(initial, "p-alice")).rejects.toMatchObject({ name: "SessionPersistenceError" });
});
