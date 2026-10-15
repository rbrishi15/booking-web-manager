"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import styles from "../_components/auth.module.css";
import { EmailConfirmationNotice } from "../_components/email-confirmation-notice";
import { describedBy, FieldError } from "../_components/field-error";
import { PasswordInput } from "../_components/password-input";
import { logIn, type LoginState } from "./actions";

const initialState: LoginState = { status: "idle" };

interface LoginFormProps {
  /** The page the user was trying to open before being sent to log in, if any. */
  readonly next?: string;
}

/** UC1-02 Authenticate User form (mockup 03). */
export function LoginForm({ next }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(logIn, initialState);
  const [, startTransition] = useTransition();
  const errors = state.fieldErrors ?? {};

  // Submit without React's automatic form reset, so the email stays filled in after an error.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // already sending: ignore a second Enter/click
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <div className="space-y-5">
      {state.status === "check-email" && <EmailConfirmationNotice key={state.email} email={state.email} />}
      <form onSubmit={handleSubmit} noValidate className={styles.form}>
        {state.status === "error" && state.message !== undefined && (
          <ErrorMessage>{state.message}</ErrorMessage>
        )}

        {next !== undefined && <input type="hidden" name="next" value={next} />}

        <div className={styles.field}>
          <Label htmlFor="email">Email</Label>
          <Input
            className={styles.input}
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

        <div className={styles.field}>
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            className={`${styles.input} ${styles.passwordInput}`}
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            aria-invalid={errors.password !== undefined}
            aria-describedby={describedBy(errors.password !== undefined && "password-error")}
          />
          <FieldError id="password-error" messages={errors.password} />
        </div>

        <Button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Logging in…" : "Log in"}
        </Button>

        <p className={styles.footer}>
          New to Booking?{" "}
          <Link href="/register">
            Create account
          </Link>
        </p>
      </form>
    </div>
  );
}
