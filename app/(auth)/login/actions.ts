"use server";

import { redirect } from "next/navigation";
import { getAccountStatus } from "@/lib/supabase/account-status";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "../redirect-path";
import { loginSchema } from "../schemas";

type LoginField = "email" | "password";

export interface LoginState {
  readonly status: "idle" | "error" | "check-email";
  readonly email?: string;
  readonly message?: string;
  readonly fieldErrors?: Partial<Record<LoginField, string[]>>;
}

/** UC1-02 exception 2a: one message for any wrong email/password, never saying which was wrong. */
const INVALID_CREDENTIALS = "Invalid email or password.";

/** UC1-02 Authenticate User: checks the form, logs in with Supabase, then goes to Home (or `next`). */
export async function logIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  // 1. Validate at the boundary.
  const parsed = loginSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // 2. Ask Supabase to check the email and password. On success it sets the login cookie.
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error !== null) {
    if (error.code === "email_not_confirmed") {
      return {
        status: "check-email",
        email: parsed.data.email,
        message: "Please confirm your email first, using the link we sent you.",
      };
    }
    if (error.code !== "invalid_credentials") {
      console.error("UC1-02 log-in failed:", error.code, error.message);
    }
    return { status: "error", message: INVALID_CREDENTIALS };
  }

  // 3. UC1-04: a deleted (INACTIVE) account must not be able to log in.
  // If the status can't be checked, refuse rather than risk letting an inactive account in.
  const account = await getAccountStatus(supabase, data.user.id);
  if (account.kind !== "active") {
    await supabase.auth.signOut();
    if (account.kind === "inactive") return { status: "error", message: "This account is no longer active." };
    if (account.kind === "lookup-failed") {
      console.error("UC1-02 profile check failed:", account.code, account.message);
    } else {
      console.error("UC1-02 no profile row for user", data.user.id);
    }
    return { status: "error", message: "We couldn't verify your account. Please try again." };
  }

  // 4. Logged in: go where the user was heading, or Home (HOME_PATH).
  redirect(safeRedirectPath(formData.get("next")));
}
