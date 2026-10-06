"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { resendConfirmation, type ResendConfirmationState } from "../resend-confirmation";

const initialState: ResendConfirmationState = { status: "idle" };

export function EmailConfirmationNotice({ email }: { readonly email?: string }) {
  const [state, formAction, pending] = useActionState(resendConfirmation, initialState);

  return (
    <div className="space-y-4">
      <InfoNote icon>
        <div role="status" className="space-y-2">
          <p className="font-semibold">Check your email</p>
          <p>
            Open the confirmation link{email !== undefined && <> sent to <strong>{email}</strong></>} to finish signing up.
            {" "}You are not logged in yet. After confirming, return here to log in if needed.
          </p>
          <p>If the email is missing or the link has expired, check your spam folder or request a new link.</p>
        </div>
      </InfoNote>
      {email !== undefined && (
        <form action={formAction}>
          <input type="hidden" name="email" value={email} />
          <Button type="submit" variant="outline" className="w-full" disabled={pending}>
            {pending ? "Sending confirmation email…" : "Resend confirmation email"}
          </Button>
        </form>
      )}
      {state.status === "sent" && <p role="status" className="text-sm text-muted-foreground">{state.message}</p>}
      {state.status === "error" && <ErrorMessage>{state.message}</ErrorMessage>}
    </div>
  );
}
