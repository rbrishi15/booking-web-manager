"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteMyAccount } from "./actions";

interface DeleteAccountButtonProps {
  /** Shown in the dialog so the user sees what they would forfeit (SRS special requirement). */
  readonly availableCents: number;
}

/** The final "are you sure?" step of UC1-04 (flow steps 3 and 4). */
export function DeleteAccountButton({ availableCents }: DeleteAccountButtonProps) {
  return (
    <ConfirmDialog
      trigger={<Button variant="destructive">Delete my account</Button>}
      title="Delete your account?"
      description="This cannot be undone. Your name, email and preferences are removed and you will be logged out. Any wallet balance that has not been withdrawn is forfeited."
      amountCents={availableCents}
      amountLabel="Wallet balance you would forfeit"
      confirmLabel="Yes, delete my account"
      destructive
      onConfirm={async () => {
        const result = await deleteMyAccount(); // on success the server logs you out and leaves this page
        throw new Error(result.message);
      }}
    />
  );
}