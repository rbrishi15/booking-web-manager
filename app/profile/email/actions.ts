"use server";

import { revalidatePath } from "next/cache";
import { emailConfirmationRedirectTo } from "@/app/(auth)/email-confirmation-url";
import { loginSchema } from "@/app/(auth)/schemas";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";

export interface EmailVerificationState {
  readonly status: "idle" | "sent" | "verified" | "error";
  readonly message?: string;
}

async function ownAccount() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error !== null || user === null) return null;
  const account = await getAccountStatus(supabase, user.id);
  return account.kind === "active" ? { supabase, user } : null;
}

function sentResult(error: { readonly code?: string; readonly status?: number } | null): EmailVerificationState {
  if (error !== null) {
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { status: "error", message: "Please wait a minute before requesting another confirmation email." };
    }
    return { status: "error", message: "We couldn't send a confirmation email. Please try again." };
  }
  revalidatePath("/", "layout");
  return { status: "sent", message: "A confirmation link is on its way. Check your inbox and spam folder, then check your verification status here." };
}

/** Sends only to the trusted current account; submitted email targets are ignored. */
export async function resendOwnEmailConfirmation(
  _previous: EmailVerificationState,
  _formData: FormData,
): Promise<EmailVerificationState> {
  void _formData;
  try {
    const account = await ownAccount();
    if (account === null) return { status: "error", message: "Please log in to an active account again." };
    const { supabase, user } = account;
    const email = user.email?.trim() || null;
    const pendingEmail = user.new_email?.trim() || null;
    const targetEmail = email ?? pendingEmail;
    if (targetEmail === null) return { status: "error", message: "Add an email address first." };
    if (email !== null && user.email_confirmed_at) {
      revalidatePath("/", "layout");
      return { status: "verified", message: "Your email is verified. You can create and join sessions." };
    }
    const emailRedirectTo = await emailConfirmationRedirectTo();
    if (emailRedirectTo === null) return { status: "error", message: "We couldn't verify this page's address. Reload the page and try again." };
    const { error } = email === null
      ? await supabase.auth.updateUser({ email: targetEmail }, { emailRedirectTo })
      : await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo } });
    return sentResult(error);
  } catch {
    return { status: "error", message: "We couldn't send a confirmation email. Please try again." };
  }
}

/** Adds an email without creating another account or granting booking access early. */
export async function addAccountEmail(
  _previous: EmailVerificationState,
  formData: FormData,
): Promise<EmailVerificationState> {
  const email = loginSchema.shape.email.safeParse(formData.get("email"));
  if (!email.success) return { status: "error", message: "Enter a valid email address." };
  try {
    const account = await ownAccount();
    if (account === null) return { status: "error", message: "Please log in to an active account again." };
    if (account.user.email?.trim()) return { status: "error", message: "This account already has an email address. Request its confirmation link instead." };
    const emailRedirectTo = await emailConfirmationRedirectTo();
    if (emailRedirectTo === null) return { status: "error", message: "We couldn't verify this page's address. Reload the page and try again." };
    const { error } = await account.supabase.auth.updateUser({ email: email.data }, { emailRedirectTo });
    return sentResult(error);
  } catch {
    return { status: "error", message: "We couldn't send a confirmation email. Please try again." };
  }
}

/** Re-reads Supabase rather than trusting the browser's old verification state. */
export async function refreshEmailVerification(
  _previous: EmailVerificationState,
  _formData: FormData,
): Promise<EmailVerificationState> {
  void _formData;
  try {
    const account = await ownAccount();
    if (account === null) return { status: "error", message: "Please log in to an active account again." };
    revalidatePath("/", "layout");
    if (account.user.email?.trim() && account.user.email_confirmed_at) {
      return { status: "verified", message: "Your email is verified. You can create and join sessions." };
    }
    return { status: "error", message: "Your email is still awaiting confirmation. Open the link in your inbox, then check again." };
  } catch {
    return { status: "error", message: "We couldn't check your verification status. Please try again." };
  }
}
