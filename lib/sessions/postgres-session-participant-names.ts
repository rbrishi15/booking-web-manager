import { z } from "zod";
import type { UUID } from "@/domain";
import type { SqlExecutor } from "@/lib/money/sql";
import { choice, SessionPersistenceError, text } from "./postgres-row-values";

/** Display facts come from the same SQL snapshot; no profile HTTP calls in transactions. */
export class PostgresSessionParticipantNames {
  constructor(private readonly sql: SqlExecutor) {}

  async displayNames(userIds: readonly UUID[]): Promise<ReadonlyMap<UUID, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.sql.query(
      "select user_id, display_name, account_status from profiles where user_id = any($1::uuid[])",
      [userIds],
    );
    try {
      const names = new Map(rows.map((row) => {
        const status = choice(row.account_status, ["ACTIVE", "INACTIVE"]);
        const name = z.string().nullable().parse(row.display_name);
        return [text(row.user_id), status === "INACTIVE" ? "Deleted user" : name?.trim() || "Unnamed player"] as const;
      }));
      if (userIds.some((id) => !names.has(id))) throw new SessionPersistenceError("Stored participant has no profile");
      return names;
    } catch (cause) {
      throw new SessionPersistenceError("Stored participant names could not be read", { cause });
    }
  }
}
