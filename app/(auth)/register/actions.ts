"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HOME_PATH } from "../redirect-path";
import { registerSchema } from "../schemas";



type RegisterField = "displayName" | "email" | "password" | "region" | "sport";

export interface RegisterState {
  readonly status: "idle" | "error" | "check-email";
  readonly message?: string;
  readonly fieldErrors?: Partial<Record<RegisterField, string[]>>;
  /** True when the email already has an account (UC1-01 exception 4a). */
  readonly emailTaken?: boolean;
}

/** UC1-01 Register User: validates the form, creates the Supabase account, then goes to Home. */
export async function registerUser(
  _previous: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  // 1. Validate at the boundary (CLAUDE.md: "Validate at the boundary with Zod").
  const parsed = registerSchema.safeParse({
    displayName: formData.get("displayName") ?? "",
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
    region: formData.get("region") ?? "",
    sport: formData.get("sport") ?? "",
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  // 2. Create the account. Migration 0004's trigger then creates the profile and S$0.00 wallet.
  const { displayName, email, password, region, sport } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        preferred_sports: [sport],
        preferred_regions: [region],
      },
    },
  });

  // 3. UC1-01 exception 4a: duplicate email → prompt to log in.
  const duplicate =
    error?.code === "user_already_exists" ||
    // With email confirmation on, Supabase hides duplicates by returning a user with no identities.
    (error === null && data.user !== null && data.user.identities?.length === 0);
  if (duplicate) {
    return {
      status: "error",
      message: "An account with this email already exists.",
      emailTaken: true,
    };
  }

  if (error !== null) {
    console.error("UC1-01 sign-up failed:", error.code, error.message);
    return {
      status: "error",
      message: "We couldn't create your account. Please try again.",
    };
  }

  // 4. If email confirmation is on, there is no session yet: ask the user to check their inbox.
  if (data.session === null) {
    return {
      status: "check-email",
      message: `Account created. We sent a confirmation link to ${email}. Open it, then log in.`,
    };
  }

  // 5. Logged in: go to Home & Discover. redirect() must stay outside try/catch.
  redirect(HOME_PATH);
}