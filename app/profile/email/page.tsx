import Link from "next/link";
import { redirect } from "next/navigation";
import { getCreateSessionAction } from "@/app/sessions/session-actions";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { EmailVerificationForm } from "./email-verification-form";

export const dynamic = "force-dynamic";

export default async function EmailVerificationPage({ searchParams }: { readonly searchParams: Promise<{ readonly verification?: string }> }) {
  const user = await getCurrentUser();
  if (user === null || user.accountStatus !== "ACTIVE") redirect("/login?next=%2Fprofile%2Femail");
  const { verification } = await searchParams;
  const create = getCreateSessionAction(user);
  return (
    <>
      <PageHeader breadcrumb="Settings" title="Verify email" />
      <div className="space-y-4 p-4 md:p-8">
        <Link href="/profile" className="text-sm font-medium text-muted-foreground hover:text-foreground">← Back to settings</Link>
        <div className="max-w-2xl space-y-5 rounded-lg border bg-card p-6">
          {verification === "failed" && !user.emailVerified && <ErrorMessage>We couldn&apos;t finish that confirmation link. Check your verification status below or request a new link.</ErrorMessage>}
          {verification === "pending" && !user.emailVerified && <InfoNote icon>Confirm any remaining email links, then check your verification status below.</InfoNote>}
          <EmailVerificationForm
            key={JSON.stringify([user.id, user.email, user.pendingEmail, user.emailVerified])}
            email={user.email}
            pendingEmail={user.pendingEmail}
            emailVerified={user.emailVerified}
          />
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="min-h-11"><Link href="/discover">Browse sessions</Link></Button>
            {create !== undefined && <Button asChild className="min-h-11"><Link href={create.href}>Create a session</Link></Button>}
          </div>
        </div>
      </div>
    </>
  );
}
