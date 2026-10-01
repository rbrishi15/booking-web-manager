import { Money } from "@/domain";
import {
  AccountNotActiveError,
  type AccountStanding,
  type DeleteAccountPorts,
  type ProfileSnapshot,
} from "@/use-cases/accounts/delete-account";
import { createAdminClient } from "./admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Turns a bigint column (sent as a number) into Money, refusing anything that isn't whole cents. */
function cents(value: unknown): Money {
  const amount = Number(value ?? 0);
  if (!Number.isSafeInteger(amount)) throw new Error(`Unexpected cents value: ${String(value)}`);
  return Money.fromCents(amount);
}

/** Text items of a database array column (anything else becomes []). */
function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Counts rows in a table owned by another member's migration (sessions and regular_groups
 * come from Neoh's 0005). Any error stops the deletion (fail closed), including "table not
 * found": PostgREST's schema cache can report that for a table that does exist, and treating
 * it as "no obligations" could let an account with outstanding sessions or groups be deleted.
 */
async function countRows(
  admin: AdminClient,
  table: string,
  filter: (query: ReturnType<ReturnType<AdminClient["from"]>["select"]>) => PromiseLike<{
    count: number | null;
    error: { code?: string } | null;
  }>,
): Promise<number> {
  const { count, error } = await filter(admin.from(table).select("*", { count: "exact", head: true }));
  if (error !== null) throw error;
  return count ?? 0;
}

/** The real UC1-04 ports, backed by Supabase with the service role key. Server only. */
export function supabaseDeleteAccountPorts(): DeleteAccountPorts {
  const admin = createAdminClient();

  return {
    async loadStanding(userId): Promise<AccountStanding> {
      const { data: wallet, error: walletError } = await admin
        .from("wallets")
        .select("wallet_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (walletError !== null) throw walletError;

      let availableBalance = Money.fromCents(0);
      let heldBalance = Money.fromCents(0);
      let activeCommitments = 0;

      if (wallet !== null) {
        const { data: balance, error: balanceError } = await admin
          .from("wallet_balances")
          .select("available_cents")
          .eq("wallet_id", wallet.wallet_id)
          .maybeSingle();
        if (balanceError !== null) throw balanceError;
        availableBalance = cents(balance?.available_cents);

        // An open hold (not yet released, refunded or forfeited) is money locked for a session commitment.
        const { data: holds, error: holdsError } = await admin
          .from("hold_balances")
          .select("held_cents")
          .eq("wallet_id", wallet.wallet_id)
          .is("settled_kind", null);
        if (holdsError !== null) throw holdsError;
        activeCommitments = holds.length;
        heldBalance = Money.fromCents(holds.reduce((sum, hold) => sum + cents(hold.held_cents).toCents(), 0));
      }

      // Sessions and groups live in Neoh's migration 0005 (sessions, regular_groups).
      const unsettledOwnedSessions = await countRows(admin, "sessions", (query) =>
        query.eq("booker_id", userId).not("status", "in", "(SETTLED,CANCELLED)"),
      );
      const pendingPayouts = await countRows(admin, "sessions", (query) =>
        query.eq("booker_id", userId).in("status", ["AWAITING_PAYOUT", "PAYOUT_PENDING"]),
      );
      const activeOwnedGroups = await countRows(admin, "regular_groups", (query) =>
        query.eq("owner_id", userId).eq("status", "ACTIVE"),
      );

      return {
        walletId: wallet?.wallet_id ?? null,
        availableBalance,
        heldBalance,
        activeCommitments,
        unsettledOwnedSessions,
        pendingPayouts,
        activeOwnedGroups,
      };
    },

    async deactivateProfile(userId): Promise<ProfileSnapshot> {
      const { data: before, error: readError } = await admin
        .from("profiles")
        .select("display_name, preferred_sports, preferred_regions")
        .eq("user_id", userId)
        .single();
      if (readError !== null) throw readError;

      // Blank the personal details and mark INACTIVE. Login and middleware now refuse the account.
      // Only an ACTIVE profile is claimed, in one UPDATE: if two deletions run at once, only one
      // of them can claim it, and only that one may later restore it.
      const { error, count } = await admin
        .from("profiles")
        .update(
          { display_name: "", preferred_sports: [], preferred_regions: [], account_status: "INACTIVE" },
          { count: "exact" },
        )
        .eq("user_id", userId)
        .eq("account_status", "ACTIVE");
      if (error !== null) throw error;
      if (count === 0) throw new AccountNotActiveError(userId);
      if (count !== 1) throw new Error(`UC1-04: expected one profile row for ${userId}, updated ${count}`);

      return {
        userId,
        displayName: typeof before.display_name === "string" ? before.display_name : "",
        preferredSports: textList(before.preferred_sports),
        preferredRegions: textList(before.preferred_regions),
      };
    },

    async restoreProfile(snapshot) {
      // Only undo our own deactivation: the profile must still be INACTIVE.
      const { error, count } = await admin
        .from("profiles")
        .update(
          {
            display_name: snapshot.displayName,
            preferred_sports: [...snapshot.preferredSports],
            preferred_regions: [...snapshot.preferredRegions],
            account_status: "ACTIVE",
          },
          { count: "exact" },
        )
        .eq("user_id", snapshot.userId)
        .eq("account_status", "INACTIVE");
      if (error !== null) throw error;
      if (count !== 1) throw new Error(`UC1-04: expected to restore one profile for ${snapshot.userId}, updated ${count}`);
    },

    async deleteLogin(userId) {
      // Supabase's soft delete scrambles the email, wipes the sign-up details and ends every session,
      // but keeps the row, so the profile and wallet records stay linked for audit.
      const { error } = await admin.auth.admin.deleteUser(userId, true);
      if (error !== null) throw error;
    },
  };
}