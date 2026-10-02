"use server";

import { createClient } from "@/lib/supabase/server";
import { emailConfirmationRedirectTo } from "./email-confirmation-url";
import { loginSchema } from "./schemas";

export interface ResendConfirmationState {
  readonly status: "idle" | "sent" | "error";
  readonly message?: string;
}

const SENT_MESSAGE = "If this email has an account awaiting confirmation, a new link is on its way. Check your inbox and spam folder.";

/** UC1-01/UC1-02: recover a missing or expired verification email without starting registration again. */
export async function resendConfirmation(
  _previous: ResendConfirmationState,
  formData: FormData,
): Promise<ResendConfirmationState> {
  const email = loginSchema.shape.email.safeParse(formData.get("email"));
  if (!email.success) return { status: "error", message: "Enter a valid email address." };

  try {
    const emailRedirectTo = await emailConfirmationRedirectTo();
    if (emailRedirectTo === null) {
      return { status: "error", message: "We couldn't verify this page's address. Reload the page and try again." };
    }
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.data,
      options: { emailRedirectTo },
    });

    if (error === null || error.code === "user_not_found") {
      return { status: "sent", message: SENT_MESSAGE };
    }
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return { status: "error", message: "Please wait a minute before requesting another confirmation email." };
    }
    console.error("UC1-01 confirmation resend failed:", error.code);
  } catch {
    console.error("UC1-01 confirmation resend could not be completed.");
  }

  return { status: "error", message: "We couldn't send a confirmation email. Please try again." };
}
