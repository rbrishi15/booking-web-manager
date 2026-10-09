import { describe, expect, test, vi } from "vitest";
import { PostgresDueSessionQuery } from "@/lib/commit/postgres-due-session-query";
import { PostgresVerificationReminderQuery } from "@/lib/commit/postgres-verification-reminder-query";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";

const sessionId = "20000000-0000-4000-8000-000000000001";
const bookerId = "10000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-07T10:00:00Z");

function executor(rows: SqlRow[] = []) {
  const query = vi.fn(async () => rows);
  return { sql: { query } as SqlExecutor, query };
}

describe("PostgresDueSessionQuery", () => {
  test("dueSessionIds_WhenCalled_PassesNowTheAutoVerifyCutoffAndLimit", async () => {
    // Arrange
    const { sql, query } = executor([{ session_id: sessionId }]);

    // Act
    const ids = await new PostgresDueSessionQuery(sql).dueSessionIds(now, 25);

    // Assert
    expect(ids).toEqual([sessionId]);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.any(String), [
      now,
      new Date("2026-10-04T10:00:00Z"),
      25,
    ]);
  });
});

describe("PostgresVerificationReminderQuery", () => {
  test("claimVerificationReminders_WhenDue_ReturnsSessionAndBooker", async () => {
    // Arrange
    const { sql, query } = executor([{ session_id: sessionId, booker_id: bookerId }]);

    // Act
    const reminders = await new PostgresVerificationReminderQuery(
      sql,
    ).claimVerificationReminders(now, 10);

    // Assert
    expect(reminders).toEqual([{ sessionId, bookerId }]);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("for update skip locked"),
      [now, 10],
    );
  });

  test("releaseVerificationReminders_WhenEmpty_DoesNotQuery", async () => {
    // Arrange
    const { sql, query } = executor();

    // Act
    await new PostgresVerificationReminderQuery(sql).releaseVerificationReminders([]);

    // Assert
    expect(query).not.toHaveBeenCalled();
  });

  test("releaseVerificationReminders_WhenClaimed_ClearsTheirMarks", async () => {
    // Arrange
    const { sql, query } = executor();

    // Act
    await new PostgresVerificationReminderQuery(sql).releaseVerificationReminders([
      sessionId,
    ]);

    // Assert
    expect(query).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("verification_reminded_at = null"),
      [[sessionId]],
    );
  });
});
