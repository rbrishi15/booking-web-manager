import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { supabaseDeleteAccountPorts } from "@/lib/supabase/account-admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { canDeactivate } from "@/use-cases/accounts/delete-account";
import { DeleteAccountButton } from "./delete-account-button";

/** UC1-04 Delete Account: shows what is still outstanding, then offers the final confirmation. */
export default async function DeleteAccountPage() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");

  // Flow step 2: check the wallet and commitments before offering deletion.
  const standing = await supabaseDeleteAccountPorts().loadStanding(user.id);
  const allowed = canDeactivate({ userId: user.id, email: user.email, now: new Date() }, standing);

  return (
    <>
      <PageHeader breadcrumb="Settings" title="Delete account" />
      <div className="space-y-4 p-4 md:p-8">
        <Link href="/profile" className="text-sm font-medium text-muted-foreground hover:text-foreground">
          ← Back to settings
        </Link>

        <div className="max-w-2xl space-y-6 rounded-lg border bg-card p-6">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary p-4">
              <dt className="text-xs text-muted-foreground">Available balance</dt>
              <dd className="text-lg font-semibold">
                <Money cents={standing.availableBalance.toCents()} />
              </dd>
            </div>
            <div className="rounded-lg bg-secondary p-4">
              <dt className="text-xs text-muted-foreground">Held for sessions</dt>
              <dd className="text-lg font-semibold">
                <Money cents={standing.heldBalance.toCents()} />
              </dd>
            </div>
            <div className="rounded-lg bg-secondary p-4">
              <dt className="text-xs text-muted-foreground">Active commitments</dt>
              <dd className="text-lg font-semibold">{standing.activeCommitments}</dd>
            </div>
          </dl>

          {allowed ? (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <p className="font-medium">Deleting your account will:</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>remove your name, email and preferences, and log you out for good;</li>
                  <li>keep past session and wallet records, without your name, for audit;</li>
                  <li>forfeit any wallet balance that has not been withdrawn.</li>
                </ul>
              </div>
              <DeleteAccountButton availableCents={standing.availableBalance.toCents()} />
            </div>
          ) : (
            <div className="space-y-4">
              <ErrorMessage>
                You must complete your active sessions and use or withdraw your remaining funds before deleting your
                account.
              </ErrorMessage>
              <Button asChild variant="outline">
                <Link href="/wallet">Go to wallet</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}