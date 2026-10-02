import { describe, expect, test, vi } from "vitest";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";
import { PostgresSessionManagementRepository } from "@/lib/sessions/postgres-session-management-repository";
import { createTestSession } from "../../domain/sessions/session/session-fixtures";

const startAt = new Date("2040-01-02T10:00:00Z");
const now = new Date("2040-01-01T10:00:00Z");

function sessionRow(overrides: SqlRow = {}): SqlRow {
  return {
    session_id: "s", booker_id: "booker", venue_name: "Sports Hall", sport: "Badminton", region: "West",
    start_at: startAt, end_at: new Date("2040-01-02T12:00:00Z"), total_cost_cents: "1001",
    total_slots: 3, minimum_headcount: 2, booking_share_cents: "333", visibility: "PRIVATE", status: "OPEN",
    minimum_reliability: "75.5", room_token: "room", holding_account_id: "platform", invited_group_id: null,
    next_queue_sequence: 1, payout_attempt_ids: [], payout_idempotency_keys: [], pending_settlement: null,
    ...overrides,
  };
}

function participantRow(overrides: SqlRow = {}): SqlRow {
  return {
    session_id: "s", participation_id: "p", user_id: "alice", status: "COMMITTED", attendance: "UNVERIFIED",
    waitlisted_at: null, committed_at: now, withdrawn_at: null, replacement_mode: null, replacement_invitee_id: null,
    verified_at: null, verification_method: null, replaces_participation_id: null, queue_sequence: null,
    participant_wallet_id: "wallet", hold_id: "h", hold_participation_id: "p", holding_account_id: "platform",
    wallet_id: "wallet", payout_id: null, amount_cents: "333", hold_state: "HELD", hold_created_at: now, settled_at: null,
    ...overrides,
  };
}

function scenario(rows = [sessionRow()], participants: readonly SqlRow[] = []) {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValueOnce(rows).mockResolvedValueOnce(participants);
  return { query, repository: new PostgresSessionManagementRepository({ query: query as SqlExecutor["query"] }) };
}

test("hydrates the full booking, participant list and optional configuration under a root update lock", async () => {
  const { query, repository } = scenario([sessionRow({ invited_group_id: "group" })], [participantRow()]);
  const session = await repository.get("s");
  expect(session).toMatchObject({ sessionId: "s", bookerId: "booker", invitedGroupId: "group", visibility: "PRIVATE" });
  expect(session?.booking.totalCost.toCents()).toBe(1001);
  expect(session?.minimumReliability?.toNumber()).toBe(75.5);
  expect(session?.participantList.participations[0]?.hold?.amount.toCents()).toBe(333);
  expect(session?.getAvailableSlots(now)).toBe(2);
  expect(query.mock.calls[0]?.[0]).toContain("for update");
  expect(query.mock.calls[0]?.[1]).toEqual(["s"]);
  expect(query.mock.calls[1]?.[0]).toContain("order by p.session_id, p.list_position");
});

test("returns null for a missing session without querying its children", async () => {
  const { query, repository } = scenario([]);
  expect(await repository.get("missing")).toBeNull();
  expect(query).toHaveBeenCalledOnce();
});

test("hydrates a custom price and preserves historical hold amounts", async () => {
  const session = await scenario([sessionRow({ booking_share_cents: "600" })], [participantRow()]).repository.get("s");
  expect(session?.bookingShare.toCents()).toBe(600);
  expect(session?.participantList.participations[0]?.hold?.amount.toCents()).toBe(333);
});

test("lists only the owner's upcoming open sessions, including full sessions, without update locks", async () => {
  const { query, repository } = scenario();
  await repository.listUpcoming("booker", now);
  expect(query.mock.calls[0]?.[0]).toContain("booker_id = $1 and status = 'OPEN' and start_at > $2");
  expect(query.mock.calls[0]?.[0]).not.toMatch(/for update|visibility =|count\(/i);
  expect(query.mock.calls[0]?.[1]).toEqual(["booker", now]);
});

test("preserves participant-list order for equal withdrawal times and subtracts direct invitations from capacity", async () => {
  const withdrawn = { status: "WITHDRAWN", withdrawn_at: now, hold_state: "AWAITING_REPLACEMENT", replacement_mode: "OPEN_SLOT" };
  const { repository } = scenario([sessionRow()], [
    participantRow({ ...withdrawn, participation_id: "second", hold_participation_id: "second", hold_id: "second-hold", user_id: "ben" }),
    participantRow({ ...withdrawn }),
    participantRow({ ...withdrawn, participation_id: "invitation", hold_participation_id: "invitation", hold_id: "invite-hold", user_id: "cara", replacement_mode: "DIRECT_INVITE", replacement_invitee_id: "dana" }),
  ]);
  const session = await repository.get("s");
  expect(session?.participantList.oldestAwaitingReplacement()?.participationId).toBe("second");
  expect(session?.getAvailableSlots(now)).toBe(2);
});

describe("stored state validation", () => {
  test.each([
    { payout_attempt_ids: undefined },
    { payout_idempotency_keys: null },
    { total_cost_cents: "9007199254740992" },
    { booking_share_cents: "667" },
    { status: "PAYOUT_PENDING" },
    { pending_settlement: {} },
  ])("rejects invalid or missing Session facts: %j", async (invalid) => {
    await expect(scenario([sessionRow(invalid)]).repository.get("s"))
      .rejects.toMatchObject({ name: "SessionPersistenceError" });
  });

  test.each([
    { participant_wallet_id: null },
    { wallet_id: "foreign-wallet" },
    { hold_id: null },
    { hold_participation_id: "foreign-participation" },
    { holding_account_id: "foreign-holding" },
    { amount_cents: "bad" },
  ])("rejects invalid or missing participation facts: %j", async (invalid) => {
    await expect(scenario([sessionRow()], [participantRow(invalid)]).repository.get("s"))
      .rejects.toMatchObject({ name: "SessionPersistenceError" });
  });
});

test("hydrates a complete pending settlement and retained payout history", async () => {
  const batch = {
    payoutId: "out", sessionId: "s", idempotencyKey: "key", requestedAt: startAt.toISOString(),
    destination: { payoutAccountId: "pa", userId: "booker", providerAccountReference: "provider", bankAccountReference: "bank" },
    lines: [{ holdId: "h", participationId: "p", holdingAccountId: "platform", walletId: "wallet", amountCents: 333, kind: "RELEASE" }],
  };
  const rows = [sessionRow({ status: "PAYOUT_PENDING", payout_attempt_ids: ["earlier", "out"], payout_idempotency_keys: ["earlier-key", "key"], pending_settlement: batch })];
  const participants = [participantRow({ attendance: "ATTENDED", verified_at: startAt, verification_method: "BOOKER" })];
  const session = await scenario(rows, participants).repository.get("s");
  expect(session?.payoutAttemptIds).toEqual(["earlier", "out"]);
  expect(session?.pendingSettlement?.requestedAt).toEqual(startAt);
  expect(session?.pendingSettlement?.lines[0]?.amount.toCents()).toBe(333);
  await expect(scenario([sessionRow({ ...rows[0], pending_settlement: { ...batch, requestedAt: "not-a-date" } })], participants).repository.get("s"))
    .rejects.toMatchObject({ name: "SessionPersistenceError" });
});

test.each(["CANCELLED", "SETTLED", "AWAITING_PAYOUT"])("hydrates %s without erasing recorded history", async (status) => {
  const session = await scenario([sessionRow({ status, payout_attempt_ids: ["old"], payout_idempotency_keys: ["old-key"] })]).repository.get("s");
  expect(session?.status).toBe(status);
  expect(session?.payoutAttemptIds).toEqual(["old"]);
});

test("preserves SQL failures rather than disguising them as hydration errors", async () => {
  const failure = new Error("database unavailable");
  const { repository, query } = scenario();
  query.mockReset().mockResolvedValueOnce([sessionRow()]).mockRejectedValueOnce(failure);
  await expect(repository.get("s")).rejects.toBe(failure);
});

test("writes only visibility and rejects a missing update target", async () => {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValueOnce([{ session_id: "s" }]).mockResolvedValueOnce([]);
  const repository = new PostgresSessionManagementRepository({ query: query as SqlExecutor["query"] });
  const session = createTestSession();
  await repository.saveVisibility(session);
  expect(query.mock.calls[0]).toEqual([
    "update sessions set visibility = $2 where session_id = $1 returning session_id", ["s", "PUBLIC"],
  ]);
  await expect(repository.saveVisibility(session)).rejects.toMatchObject({ name: "SessionPersistenceError" });
});
