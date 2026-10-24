import { z } from "zod";
import type { UserHandle } from "@/domain/accounts/user-handle";
import type { SqlExecutor } from "@/lib/money/sql";
import type { UserDirectory, UserSummary } from "@/use-cases/accounts/user-handles";

/** A stored profile row that cannot become a UserSummary. */
export class UserDirectoryReadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserDirectoryReadError";
  }
}

const summaryRow = z.object({ user_id: z.string(), handle: z.string(), display_name: z.string() });

/**
 * Reads user IDs over the server's database connection. The lookup returns only the
 * user's ID, user ID and name, and only for ACTIVE accounts (ADR-0021).
 */
export class PostgresUserDirectory implements UserDirectory {
  constructor(private readonly sql: SqlExecutor) {}

  async isHandleFree(handle: UserHandle): Promise<boolean> {
    const rows = await this.sql.query("select 1 from profiles where handle = $1 limit 1", [handle.toString()]);
    return rows.length === 0;
  }

  async findActiveByHandle(handle: UserHandle): Promise<UserSummary | null> {
    const rows = await this.sql.query(
      `select user_id, handle, display_name from profiles
       where handle = $1 and account_status = 'ACTIVE'`,
      [handle.toString()],
    );
    const row = rows[0];
    if (row === undefined) return null;
    // Keep SQL failures outside this wrapper so they are not reported as bad stored data.
    try {
      const stored = summaryRow.parse(row);
      return { userId: stored.user_id, handle: stored.handle, displayName: stored.display_name.trim() || "Unnamed player" };
    } catch (cause) {
      throw new UserDirectoryReadError("Stored user ID could not be read", { cause });
    }
  }
}
