import { beforeEach, describe, expect, test, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseDeleteAccountPorts } from "@/lib/supabase/account-admin";
import { AccountNotActiveError } from "@/use-cases/accounts/delete-account";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = { userId: USER_ID, displayName: "Marcus Lim", preferredSports: ["Tennis"], preferredRegions: [] };

type Call = readonly [method: string, ...args: unknown[]];
interface Query {
  readonly table: string;
  readonly calls: Call[];
}

/**
 * A stand-in for the Supabase admin client. Every query records its method calls
 * (select, update, eq, ...) and, when awaited, resolves to whatever `respond` returns
 * for that table and those calls.
 */
function fakeAdmin(respond: (table: string, calls: readonly Call[]) => unknown) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const builder: object = new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "then") {
              return (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
                Promise.resolve(respond(table, query.calls)).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              query.calls.push([String(property), ...args]);
              return builder;
            };
          },
        },
      );
      return builder;
    },
  };
  vi.mocked(createAdminClient).mockReturnValue(client as never);
  return queries;
}

const isUpdate = (calls: readonly Call[]) => calls[0]?.[0] === "update";
const filters = (query: Query | undefined) => query?.calls.filter(([method]) => method === "eq");

describe("supabaseDeleteAccountPorts (UC1-04)", () => {
  beforeEach(() => {
    vi.mocked(createAdminClient).mockReset();
  });

  describe("loadStanding", () => {
    test("refuses to report no obligations when a table is missing from the schema cache", async () => {
      // Arrange: PostgREST says "table not found" for sessions (stale cache or missing migration).
      fakeAdmin((table) => {
        if (table === "wallets") return { data: null, error: null };
        return { count: null, error: { code: "PGRST205", message: "Could not find the table 'public.sessions'" } };
      });

      // Act & Assert
      await expect(supabaseDeleteAccountPorts().loadStanding(USER_ID)).rejects.toMatchObject({ code: "PGRST205" });
    });

    test("reports owned sessions, pending payouts and active groups from the database", async () => {
      // Arrange
      const queries = fakeAdmin((table, calls) => {
        if (table === "wallets") return { data: null, error: null };
        if (table === "regular_groups") return { count: 3, error: null };
        const payoutQuery = calls.some(([method]) => method === "in");
        return { count: payoutQuery ? 2 : 1, error: null };
      });

      // Act
      const standing = await supabaseDeleteAccountPorts().loadStanding(USER_ID);

      // Assert
      expect(standing).toMatchObject({ unsettledOwnedSessions: 1, pendingPayouts: 2, activeOwnedGroups: 3 });
      expect(filters(queries.find((query) => query.table === "regular_groups"))).toEqual([
        ["eq", "owner_id", USER_ID],
        ["eq", "status", "ACTIVE"],
      ]);
    });
  });

  describe("deactivateProfile", () => {
    test("claims only an ACTIVE profile, in one update", async () => {
      // Arrange
      const queries = fakeAdmin((_table, calls) =>
        isUpdate(calls)
          ? { error: null, count: 1 }
          : { data: { display_name: "Marcus Lim", preferred_sports: ["Tennis"], preferred_regions: [] }, error: null },
      );

      // Act
      const snapshot = await supabaseDeleteAccountPorts().deactivateProfile(USER_ID);

      // Assert
      expect(snapshot).toEqual(SNAPSHOT);
      expect(filters(queries.find((query) => isUpdate(query.calls)))).toEqual([
        ["eq", "user_id", USER_ID],
        ["eq", "account_status", "ACTIVE"],
      ]);
    });

    test("throws AccountNotActiveError when another deletion already claimed the profile", async () => {
      // Arrange: the conditional update matched no ACTIVE row.
      fakeAdmin((_table, calls) =>
        isUpdate(calls)
          ? { error: null, count: 0 }
          : { data: { display_name: "", preferred_sports: [], preferred_regions: [] }, error: null },
      );

      // Act & Assert
      await expect(supabaseDeleteAccountPorts().deactivateProfile(USER_ID)).rejects.toBeInstanceOf(
        AccountNotActiveError,
      );
    });
  });

  describe("restoreProfile", () => {
    test("restores only a profile that is still INACTIVE", async () => {
      // Arrange
      const queries = fakeAdmin(() => ({ error: null, count: 1 }));

      // Act
      await supabaseDeleteAccountPorts().restoreProfile(SNAPSHOT);

      // Assert
      expect(filters(queries[0])).toEqual([
        ["eq", "user_id", USER_ID],
        ["eq", "account_status", "INACTIVE"],
      ]);
    });

    test("fails loudly when there was no INACTIVE profile to restore", async () => {
      // Arrange
      fakeAdmin(() => ({ error: null, count: 0 }));

      // Act & Assert
      await expect(supabaseDeleteAccountPorts().restoreProfile(SNAPSHOT)).rejects.toThrow(
        "expected to restore one profile",
      );
    });
  });
});
