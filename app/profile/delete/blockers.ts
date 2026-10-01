import type { AccountStanding } from "@/use-cases/accounts/delete-account";

/** One thing stopping the account from being deleted (UC1-04 exception 2a). Money is integer cents. */
export type DeletionBlocker = { readonly label: string } & ({ readonly cents: number } | { readonly count: number });

/** Everything still blocking deletion, in the order the user should deal with it. Zero items are left out. */
export function deletionBlockers(standing: AccountStanding): readonly DeletionBlocker[] {
  const blockers: DeletionBlocker[] = [
    { label: "Sessions you've committed to", count: standing.activeCommitments },
    { label: "Money held for those sessions", cents: standing.heldBalance.toCents() },
    { label: "Sessions you booked that aren't settled", count: standing.unsettledOwnedSessions },
    { label: "Payouts still on their way to you", count: standing.pendingPayouts },
    { label: "Groups you own that aren't archived", count: standing.activeOwnedGroups },
    { label: "Wallet balance to withdraw or use", cents: standing.availableBalance.toCents() },
  ];
  return blockers.filter((blocker) => ("cents" in blocker ? blocker.cents : blocker.count) > 0);
}
