"use server";

import { redirect } from "next/navigation";
import { supabaseDeleteAccountPorts } from "@/lib/supabase/account-admin";
import { createClient } from "@/lib/supabase/server";
import { deleteAccount } from "@/use-cases/accounts/delete-account";

export interface DeleteAccountState {
  readonly message: string;
}

/** UC1-04 Delete Account: runs after the user confirms in the dialog. */
export async function deleteMyAccount(): Promise<DeleteAccountState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null || user.email === undefined) return { message: "Please log in again." };

  try {
    // The server re-checks everything here; it never trusts what the page showed earlier.
    const result = await deleteAccount(supabaseDeleteAccountPorts(), {
      userId: user.id,
      email: user.email,
      now: new Date(),
    });
    if (result.status === "BLOCKED") {
      return {
        message:
          "You must complete your active sessions, use or withdraw your remaining funds, and archive any groups you own before deleting your account.",
      };
    }
  } catch (error) {
    console.error("UC1-04 delete account failed:", error);
    return { message: "We couldn't delete your account. Please try again." };
  }

  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}