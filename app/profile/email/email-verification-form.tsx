"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addAccountEmail, type EmailVerificationState, refreshEmailVerification, resendOwnEmailConfirmation } from "./actions";

const initial: EmailVerificationState = { status: "idle" };

export function EmailVerificationForm({ email, pendingEmail, emailVerified }: {
  readonly email: string | null;
  readonly pendingEmail: string | null;
  readonly emailVerified: boolean;
}) {
  const [added, add, adding] = useActionState(addAccountEmail, initial);
  const [sent, resend, sending] = useActionState(resendOwnEmailConfirmation, initial);
  const [checked, check, checking] = useActionState(refreshEmailVerification, initial);
  const busy = adding || sending || checking;
  if (emailVerified || checked.status === "verified" || sent.status === "verified") {
    return <InfoNote icon>Your email address is verified.</InfoNote>;
  }

  return (
    <div className="space-y-5">
      <InfoNote icon>
        <p>{email === null ? "Add an email address to create or join sessions. Supabase may require a confirmation link when adding or changing an address." : "Your email address is linked. You can create and join sessions without confirming it."}</p>
        {(email ?? pendingEmail) !== null && <p className="mt-2">Check the confirmation link sent to <strong>{email ?? pendingEmail}</strong>.</p>}
        <p className="mt-2">Open the link in this browser. If it opened in another browser, return here and check your verification status.</p>
      </InfoNote>
      {email === null && (
        <form action={add} className="space-y-3">
          <Label htmlFor="account-email">{pendingEmail === null ? "Add an email address" : "Email address to confirm"}</Label>
          <Input id="account-email" name="email" type="email" autoComplete="email" defaultValue={pendingEmail ?? ""} required aria-describedby={added.status === "error" ? "add-email-error" : undefined} />
          <Button type="submit" className="min-h-11" disabled={busy}>{adding ? "Sending confirmation…" : pendingEmail === null ? "Send confirmation link" : "Update email"}</Button>
          <VerificationResult state={added} id="add-email-error" />
        </form>
      )}
      {(email ?? pendingEmail) !== null && (
        <form action={resend} className="space-y-3">
          <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>{sending ? "Sending confirmation…" : "Resend confirmation email"}</Button>
          <VerificationResult state={sent} />
        </form>
      )}
      <form action={check} className="space-y-3">
        <Button type="submit" variant="outline" className="min-h-11" disabled={busy}>{checking ? "Checking…" : "I've confirmed my email — check again"}</Button>
        <VerificationResult state={checked} />
      </form>
    </div>
  );
}

function VerificationResult({ state, id }: { readonly state: EmailVerificationState; readonly id?: string }) {
  if (state.status === "idle") return null;
  if (state.status === "error") return <div id={id}><ErrorMessage>{state.message}</ErrorMessage></div>;
  return <p role="status" className="text-sm text-muted-foreground">{state.message}</p>;
}
