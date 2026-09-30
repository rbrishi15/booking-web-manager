import { Money } from "@/domain";
import type { AccountStanding, DeleteAccountPorts } from "@/use-cases/accounts/delete-account";
import { createAdminClient } from "./admin";

/** Turns a bigint column (sent as a number) into Money, refusing anything that isn't whole cents. */
function cents(value: unknown): Money {
  const amount = Number(value ?? 0);
  if (!Number.isSafeInteger(amount)) throw new Error(`Unexpected cents value: ${String(value)}`);
  return Money.fromCents(amount);
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

      // UC1-06: a user who still owns an active group must archive it first.
      const { count: ownedGroups, error: groupsError } = await admin
        .from("regular_groups")
        .select("group_id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .eq("status", "ACTIVE");
      if (groupsError !== null) throw groupsError;

      return {
        walletId: wallet?.wallet_id ?? null,
        availableBalance,
        heldBalance,
        activeCommitments,
        // Not in the database on main yet. Wire these up when their tables land:
        unsettledOwnedSessions: 0, // Neoh: sessions (0005)
        pendingPayouts: 0, // Rishi: payouts
        activeOwnedGroups: ownedGroups ?? 0,
      };
    },

    async anonymiseAndDeactivate(userId) {
      // 1. The profile: blank the personal details and mark INACTIVE. Login and middleware now refuse it.
      const { error: profileError, count } = await admin
        .from("profiles")
        .update(
          { display_name: "", preferred_sports: [], preferred_regions: [], account_status: "INACTIVE" },
          { count: "exact" },
        )
        .eq("user_id", userId);
      if (profileError !== null) throw profileError;
      if (count !== 1) throw new Error(`UC1-04: expected one profile row for ${userId}, updated ${count}`);

      // 2. The login: Supabase's soft delete scrambles the email, wipes the sign-up details and ends
      //    every session, but keeps the row, so the profile and wallet records stay linked for audit.
      const { error: authError } = await admin.auth.admin.deleteUser(userId, true);
      if (authError !== null) throw authError;
    },
  };
}