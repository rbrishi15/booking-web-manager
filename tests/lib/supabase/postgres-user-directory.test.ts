import { describe, expect, test, vi } from "vitest";
import { UserHandle } from "@/domain/accounts/user-handle";
import type { SqlExecutor, SqlRow } from "@/lib/money/sql";
import { PostgresUserDirectory, UserDirectoryReadError } from "@/lib/supabase/postgres-user-directory";

function databaseReturning(rows: readonly SqlRow[]) {
  const query = vi.fn<SqlExecutor["query"]>().mockResolvedValue(rows);
  return { query, directory: new PostgresUserDirectory({ query: query as SqlExecutor["query"] }) };
}

// Owner: Joseph (Jolingoes) — /lib/supabase (ADR-0021)
describe("PostgresUserDirectory", () => {
  test("reports a user ID as free when no profile holds it", async () => {
    // Arrange
    const { query, directory } = databaseReturning([]);

    // Act
    const free = await directory.isHandleFree(UserHandle.parse("@Marcus_Lim"));

    // Assert
    expect(free).toBe(true);
    expect(query).toHaveBeenCalledExactlyOnceWith("select 1 from profiles where handle = $1 limit 1", ["marcus_lim"]);
  });

  test("reports a user ID as taken when any profile holds it", async () => {
    // Arrange
    const { directory } = databaseReturning([{ "?column?": 1 }]);

    // Act
    const free = await directory.isHandleFree(UserHandle.parse("marcus_lim"));

    // Assert
    expect(free).toBe(false);
  });

  test("finds only an ACTIVE account and returns its public summary", async () => {
    // Arrange
    const { query, directory } = databaseReturning([{ user_id: "u1", handle: "marcus_lim", display_name: " Marcus Lim " }]);

    // Act
    const found = await directory.findActiveByHandle(UserHandle.parse("marcus_lim"));

    // Assert
    expect(found).toEqual({ userId: "u1", handle: "marcus_lim", displayName: "Marcus Lim" });
    expect(query.mock.calls[0]?.[0]).toContain("account_status = 'ACTIVE'");
    expect(query.mock.calls[0]?.[1]).toEqual(["marcus_lim"]);
  });

  test("shows a blank name as Unnamed player", async () => {
    // Arrange
    const { directory } = databaseReturning([{ user_id: "u1", handle: "marcus_lim", display_name: "" }]);

    // Act
    const found = await directory.findActiveByHandle(UserHandle.parse("marcus_lim"));

    // Assert
    expect(found?.displayName).toBe("Unnamed player");
  });

  test("returns null when nobody active holds the user ID", async () => {
    // Arrange
    const { directory } = databaseReturning([]);

    // Act
    const found = await directory.findActiveByHandle(UserHandle.parse("marcus_lim"));

    // Assert
    expect(found).toBeNull();
  });

  test("reports an unreadable stored row as bad stored data", async () => {
    // Arrange
    const { directory } = databaseReturning([{ user_id: "u1", handle: null, display_name: "Marcus" }]);

    // Act & Assert
    await expect(directory.findActiveByHandle(UserHandle.parse("marcus_lim"))).rejects.toBeInstanceOf(UserDirectoryReadError);
  });
});
