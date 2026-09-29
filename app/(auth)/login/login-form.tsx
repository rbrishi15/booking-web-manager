"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "../_components/field-error";
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
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {state.status === "error" && state.message !== undefined && (
        <ErrorMessage>{state.message}</ErrorMessage>
      )}

      {next !== undefined && <input type="hidden" name="next" value={next} />}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          aria-invalid={errors.email !== undefined}
          aria-describedby="email-error"
        />
        <FieldError id="email-error" messages={errors.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          aria-invalid={errors.password !== undefined}
          aria-describedby="password-error"
        />
        <FieldError id="password-error" messages={errors.password} />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Do not have an account?{" "}
        <Link href="/register" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Create one
        </Link>
      </p>
    </form>
  );
}