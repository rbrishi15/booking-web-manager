import { redirect } from "next/navigation";
import { initials } from "@/components/ui/initials";
import { PageHeader } from "@/components/ui/page-header";
import { ReliabilityBadge } from "@/components/ui/reliability-badge";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { SettingsRow } from "./_components/settings-row";

/** Shows a saved list as "Badminton, Tennis", or a prompt when nothing is saved yet. */
function listOrPrompt(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "Not set yet";
}

/** UC1-03 Manage Profile: the Settings page (mockup 10). */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (user === null) redirect("/login");

  return (
    <>
      <PageHeader breadcrumb="Account" title="Settings" />
      <div className="grid grid-cols-1 gap-8 p-4 md:p-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-8">
          <section aria-label="Your profile" className="rounded-lg border bg-card p-4 md:p-6">
            <div className="flex items-start gap-4 md:gap-5">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary text-xl font-semibold text-primary-foreground md:h-20 md:w-20 md:text-2xl"
                aria-hidden
              >
                {initials(user.displayName)}
              </div>
              <div className="min-w-0 space-y-3">
                <h2 className="truncate text-xl font-semibold">{user.displayName}</h2>
                <ReliabilityBadge score={user.reliabilityScore} />
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
                  <div className="flex flex-col-reverse">
                    <dt className="text-xs text-muted-foreground">Sessions joined</dt>
                    <dd className="text-xl font-semibold">0</dd>
                  </div>
                  <div className="flex flex-col-reverse">
                    <dt className="text-xs text-muted-foreground">Attendance rate</dt>
                    <dd className="text-xl font-semibold">–</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Preferences</h2>
            <div className="divide-y overflow-hidden rounded-lg border bg-card">
              <SettingsRow
                code="SP"
                title="Preferred sports"
                description={listOrPrompt(user.preferredSports)}
                href="/profile/edit"
              />
              <SettingsRow
                code="RG"
                title="Preferred regions"
                description={listOrPrompt(user.preferredRegions)}
                href="/profile/edit"
              />
            </div>
          </section>
        </div>

        <section className="min-w-0 space-y-3">
          <div>
            <h2 className="text-xl font-semibold">Account settings</h2>
            <p className="text-sm text-muted-foreground">Manage your profile, activity, and support preferences.</p>
          </div>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            <SettingsRow code="EP" title="Edit profile" href="/profile/edit" />
            <SettingsRow code="TH" title="Transaction history" href="/wallet" />
            <SettingsRow code="PR" title="Privacy and security" />
            <SettingsRow code="HS" title="Help and support" />
            <SettingsRow code="TC" title="Terms and conditions" />
          </div>
          <div className="overflow-hidden rounded-lg border border-destructive/30">
            <SettingsRow
              code="DA"
              title="Delete account"
              description="Remove your personal details and close your account"
              href="/profile/delete"
              tone="danger"
            />
          </div>
        </section>
      </div>
    </>
  );
}