"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AuthHeading } from "../_components/auth-frame";
import styles from "../_components/auth.module.css";
import { EmailConfirmationNotice } from "../_components/email-confirmation-notice";
import { EmailInput } from "../_components/email-input";
import { describedBy, FieldError } from "../_components/field-error";
import { PasswordInput } from "../_components/password-input";
import { REGIONS, SPORTS, registerSchema } from "../schemas";
import { registerUser, type RegisterState } from "./actions";
import { passwordStrength } from "./password-strength";

const initialState: RegisterState = { status: "idle" };
const accountSchema = registerSchema.pick({ region: true, email: true, password: true });

/** UC1-01: account details first, then the required profile before account creation. */
export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerUser, initialState);
  const [, startTransition] = useTransition();
  const [step, setStep] = useState<"account" | "profile">("account");
  const [accountErrors, setAccountErrors] = useState<RegisterState["fieldErrors"]>();
  const [password, setPassword] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLSelectElement>(null);
  const strength = passwordStrength(password);
  const errors = accountErrors ?? state.fieldErrors ?? {};

  useEffect(() => {
    if (step === "profile") nameRef.current?.focus();
  }, [step]);

  // Both steps remain mounted so Back and failed submissions preserve every draft field.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    if (step === "account") {
      const parsed = accountSchema.safeParse(Object.fromEntries(formData));
      if (!parsed.success) {
        setAccountErrors(parsed.error.flatten().fieldErrors);
        return;
      }
      setAccountErrors(undefined);
      setStep("profile");
      return;
    }
    startTransition(() => formAction(formData));
  }

  if (state.status === "check-email") {
    return (
      <>
        <AuthHeading title="Check your email" description="You're one step away from your next game." />
        <div className="space-y-4">
          <EmailConfirmationNotice email={state.email} />
          <Button asChild className={styles.submit}>
            <Link href="/login">Go to log in</Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title={step === "account" ? "Register" : "Your profile"}
        description={step === "account" ? "Create your account to get started." : "A few details to help you find your next game."}
      />
      <form onSubmit={handleSubmit} noValidate className={styles.form}>
        {accountErrors !== undefined && <ErrorMessage>Please fix the highlighted fields.</ErrorMessage>}
        {state.status === "error" && state.message !== undefined && (step === "profile" || state.fieldErrors === undefined) && (
          <ErrorMessage>
            {state.message}{" "}
            {state.emailTaken === true && (
              <Link href="/login" className="font-semibold underline underline-offset-4">
                Log in instead
              </Link>
            )}
          </ErrorMessage>
        )}

        <fieldset hidden={step !== "account"} className={styles.step}>
          <legend className="sr-only">Account details</legend>
          <div className={styles.field}>
            <Label htmlFor="region">Region</Label>
            <div className={styles.selectWrap}>
              <select
                ref={regionRef}
                id="region"
                name="region"
                defaultValue="West"
                aria-invalid={errors.region !== undefined}
                aria-describedby={describedBy(errors.region !== undefined && "region-error")}
                className={styles.select}
              >
                {REGIONS.map((region) => (
                  <option key={region} value={region}>Singapore / {region}</option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
            <FieldError id="region-error" messages={errors.region} />
          </div>

          <div className={styles.field}>
            <Label htmlFor="email">Email</Label>
            <EmailInput
              id="email"
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
              autoComplete="new-password"
              placeholder="Enter password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={errors.password !== undefined}
              aria-describedby={describedBy(
                "password-strength",
                errors.password !== undefined && "password-error",
              )}
            />
            <div className={styles.strength}>
              <div className={styles.strengthBars} aria-hidden="true">
                {[1, 2, 3].map((bar) => (
                  <span key={bar} className={cn(bar <= Math.max(1, Math.ceil(strength.score * 3 / 4)) && styles.filled)} />
                ))}
              </div>
              <p id="password-strength" className={styles.strengthLabel}>
                <span className="sr-only">Password strength: </span>{strength.label}
              </p>
            </div>
            <FieldError id="password-error" messages={errors.password} />
          </div>
        </fieldset>

        <fieldset hidden={step !== "profile"} className={styles.step}>
          <legend className="sr-only">Profile details</legend>
          <div className={styles.field}>
            <Label htmlFor="displayName">Name</Label>
            <Input
              ref={nameRef}
              className={styles.input}
              id="displayName"
              name="displayName"
              autoComplete="name"
              placeholder="Your name"
              aria-invalid={errors.displayName !== undefined}
              aria-describedby={describedBy(errors.displayName !== undefined && "displayName-error")}
            />
            <FieldError id="displayName-error" messages={errors.displayName} />
          </div>
          <div className={styles.field}>
            <Label htmlFor="sport">Preferred sport</Label>
            <div className={styles.selectWrap}>
              <select
                id="sport"
                name="sport"
                defaultValue=""
                aria-invalid={errors.sport !== undefined}
                aria-describedby={describedBy(errors.sport !== undefined && "sport-error")}
                className={styles.select}
              >
                <option value="" disabled>Choose a sport</option>
                {SPORTS.map((sport) => (
                  <option key={sport} value={sport}>{sport}</option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" />
            </div>
            <FieldError id="sport-error" messages={errors.sport} />
          </div>
        </fieldset>

        <Button type="submit" className={styles.submit} disabled={pending}>
          {pending ? "Creating account…" : step === "account" ? "Sign Up" : "Create account"}
        </Button>

        <p hidden={step !== "profile"} className={styles.terms}>
          By continuing, you agree to the{" "}
          <Link href="/terms">Terms</Link> and{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
        {step === "profile" && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setStep("account");
              requestAnimationFrame(() => regionRef.current?.focus());
            }}
          >
            Back to account details
          </Button>
        )}
        <p className={styles.footer}>
          I have an account? <Link href="/login">Login</Link>
        </p>
      </form>
    </>
  );
}
