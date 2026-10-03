"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { EmailConfirmationNotice } from "../_components/email-confirmation-notice";
import { describedBy, FieldError } from "../_components/field-error";
import { PasswordInput } from "../_components/password-input";
import { REGIONS, SPORTS } from "../schemas";
import { registerUser, type RegisterState } from "./actions";
import { passwordStrength } from "./password-strength";

const initialState: RegisterState = { status: "idle" };

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm";

/** UC1-01 Register User form (mockup 02). */
export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerUser, initialState);
  const [, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const strength = passwordStrength(password);
  const errors = state.fieldErrors ?? {};

  // Submit without React's automatic form reset, so fields keep what the user typed after an error.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // already sending: ignore a second Enter/click
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  if (state.status === "check-email") {
    return (
      <div className="space-y-4">
        <EmailConfirmationNotice email={state.email} />
        <Button asChild className="w-full">
          <Link href="/login">Go to log in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {state.status === "error" && state.message !== undefined && (
        <ErrorMessage>
          {state.message}{" "}
          {state.emailTaken === true && (
            <Link href="/login" className="font-semibold underline underline-offset-4">
              Log in instead
            </Link>
          )}
        </ErrorMessage>
      )}

      <div className="space-y-2">
        <Label htmlFor="displayName">Name</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          placeholder="Marcus Lim"
          aria-invalid={errors.displayName !== undefined}
          aria-describedby={describedBy(errors.displayName !== undefined && "displayName-error")}
        />
        <FieldError id="displayName-error" messages={errors.displayName} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="region">Singapore region</Label>
          <select
            id="region"
            name="region"
            defaultValue=""
            aria-invalid={errors.region !== undefined}
            aria-describedby={describedBy(errors.region !== undefined && "region-error")}
            className={selectClassName}
          >
            <option value="" disabled>
              Choose a region
            </option>
            {REGIONS.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
          <FieldError id="region-error" messages={errors.region} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sport">Preferred sport</Label>
          <select
            id="sport"
            name="sport"
            defaultValue=""
            aria-invalid={errors.sport !== undefined}
            aria-describedby={describedBy(errors.sport !== undefined && "sport-error")}
            className={selectClassName}
          >
            <option value="" disabled>
              Choose a sport
            </option>
            {SPORTS.map((sport) => (
              <option key={sport} value={sport}>
                {sport}
              </option>
            ))}
          </select>
          <FieldError id="sport-error" messages={errors.sport} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          aria-invalid={errors.email !== undefined}
          aria-describedby={describedBy(errors.email !== undefined && "email-error")}
        />
        <FieldError id="email-error" messages={errors.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          placeholder="Enter at least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={errors.password !== undefined}
          aria-describedby={describedBy(
            password.length > 0 && "password-strength",
            errors.password !== undefined && "password-error",
          )}
        />
        <div className="flex gap-1.5" aria-hidden>
          {[1, 2, 3, 4].map((bar) => (
            <span
              key={bar}
              className={cn("h-1 flex-1 rounded-full", bar <= strength.score ? "bg-info" : "bg-border")}
            />
          ))}
        </div>
        {password.length > 0 && (
          <p id="password-strength" className="text-xs text-muted-foreground">
            Password strength: {strength.label}
          </p>
        )}
        <FieldError id="password-error" messages={errors.password} />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        By continuing, you agree to the Terms and Privacy Policy.
        <br />
        <span className="font-medium text-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold underline-offset-4 hover:underline">
            Log in
          </Link>
        </span>
      </p>
    </form>
  );
}
