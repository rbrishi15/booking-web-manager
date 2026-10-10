import Link from "next/link";
import { getAddEmailAction } from "@/app/sessions/session-actions";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/info-note";
import type { CurrentUser } from "@/lib/supabase/current-user";

type VerificationUser = Pick<CurrentUser, "email" | "pendingEmail" | "emailVerified" | "accountStatus">;

/** A recovery prompt that leaves all browsing content accessible. */
export function SignedInVerificationPrompt({ user }: { readonly user: VerificationUser }) {
  const action = getAddEmailAction(user);
  if (action === undefined) return null;
  return (
    <div className="px-6 pt-4 md:px-8">
      <InfoNote icon>
        <div className="flex flex-wrap items-center gap-3" role="status">
          <div>
            <p className="font-semibold">Add an email address to create or join sessions.</p>
            <p>You can keep browsing.{user.pendingEmail !== null && <> A confirmation is pending for <strong>{user.pendingEmail}</strong>.</>}</p>
          </div>
          <Button asChild variant="outline" className="min-h-11"><Link href={action.href}>{user.email === null && user.pendingEmail === null ? "Add email" : "Manage email"}</Link></Button>
        </div>
      </InfoNote>
    </div>
  );
}
