import type { Pool } from "pg";
import { describe, expect, test, vi } from "vitest";
import { fingerprintOf } from "@/lib/money/idempotency";
import type { SqlRow } from "@/lib/money/sql";
import { PostgresSessionCreationTransaction } from "@/lib/sessions/postgres-session-creation-transaction";

const now = new Date("2026-10-03T00:00:00Z");
const original = { sessionId: "session", roomToken: "private-token", bookingShareCents: 500 };

describe("PostgresSessionCreationTransaction", () => {
  test("allows replay after email confirmation is removed", async () => {
    const { transaction, work } = scenario({ email_confirmed_at: null });

    expect(await transaction.runForBooker("booker", work)).toEqual(original);
    expect(work).not.toHaveBeenCalled();
  });

  test("denies replay when the booker no longer has an email", async () => {
    const { transaction, work } = scenario({ email: "", email_confirmed_at: now });

    await expect(transaction.runForBooker("booker", work))
      .rejects.toMatchObject({ code: "EMAIL_REQUIRED" });
    expect(work).not.toHaveBeenCalled();
  });

  test("denies replay after account deactivation", async () => {
    const { transaction, work } = scenario({ account_status: "INACTIVE" });

    await expect(transaction.runForBooker("booker", work))
      .rejects.toMatchObject({ code: "INACTIVE_ACCOUNT" });
    expect(work).not.toHaveBeenCalled();
  });

  test("replays for an active booker without rerunning creation work", async () => {
    const { transaction, work } = scenario();

    expect(await transaction.runForBooker("booker", work)).toEqual(original);
    expect(work).not.toHaveBeenCalled();
  });
});

function scenario(overrides: SqlRow = {}) {
  const key = JSON.stringify(["UC2-02", "booker", "submission"]);
  const query = vi.fn(async (statement: string): Promise<{ rows: SqlRow[] }> => {
    if (/^begin|^commit|^rollback/.test(statement)) return { rows: [] };
    if (statement.includes("from profiles")) return { rows: [{
      account_status: "ACTIVE", email: "booker@example.com", email_confirmed_at: now, ...overrides,
    }] };
    if (statement.includes("insert into idempotency_keys")) return { rows: [] };
    if (statement.includes("from idempotency_keys")) return { rows: [{
      status: "SUCCEEDED", request_fingerprint: fingerprintOf({ idempotencyKey: key }), response: { value: original },
    }] };
    throw new Error(`Unexpected database query: ${statement}`);
  });
  const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
  const transaction = new PostgresSessionCreationTransaction(pool, { idempotencyKey: "submission" }, { now: () => now });
  const work = vi.fn(async () => { throw new Error("Replay must not rerun creation work"); });
  return { transaction, work };
}
