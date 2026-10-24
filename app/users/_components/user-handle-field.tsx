"use client";

import { useEffect, useRef, useState } from "react";
import { describedBy, FieldError } from "@/app/(auth)/_components/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { checkUserHandleAvailability, type HandleCheck } from "../handle-availability-action";
import { normalizeUserHandle, userHandleProblem } from "../schemas";

type Status =
  | { readonly kind: "idle" | "checking" | "current" }
  | { readonly kind: "problem"; readonly message: string }
  | { readonly kind: "result"; readonly result: HandleCheck; readonly handle: string };

interface UserHandleFieldProps {
  readonly id?: string;
  readonly name?: string;
  readonly defaultValue?: string;
  /** The signed-in user's own ID, which is never reported as taken. */
  readonly currentHandle?: string | null;
  /** Errors returned by the server for this field. */
  readonly errors?: readonly string[];
  readonly className?: string;
  readonly inputClassName?: string;
  /** Wait this long after the last keystroke before asking the server. */
  readonly checkDelayMs?: number;
}

/** The user ID input (ADR-0021): an "@" prefix, the format rules and a live availability check. */
export function UserHandleField({
  id = "handle",
  name = "handle",
  defaultValue = "",
  currentHandle = null,
  errors,
  className,
  inputClassName,
  checkDelayMs = 400,
}: UserHandleFieldProps) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // A server error describes the submitted value; hide it once the user edits the field.
  const [editedAfter, setEditedAfter] = useState<readonly string[] | undefined>(undefined);
  const latestRequest = useRef(0);
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const errorId = `${id}-error`;
  const serverError = errors !== editedAfter ? errors?.[0] : undefined;

  useEffect(() => {
    const handle = normalizeUserHandle(value);
    const request = ++latestRequest.current;
    if (handle === "") {
      setStatus({ kind: "idle" });
      return;
    }
    if (currentHandle !== null && handle === currentHandle) {
      setStatus({ kind: "current" });
      return;
    }
    const problem = userHandleProblem(handle);
    if (problem !== null) {
      setStatus({ kind: "problem", message: problem });
      return;
    }
    setStatus({ kind: "checking" });
    const timer = setTimeout(() => {
      checkUserHandleAvailability(handle)
        .catch((): HandleCheck => "UNKNOWN")
        .then((result) => {
          // Ignore answers to keystrokes the user has already typed over.
          if (request === latestRequest.current) setStatus({ kind: "result", result, handle });
        });
    }, checkDelayMs);
    return () => clearTimeout(timer);
  }, [value, currentHandle, checkDelayMs]);

  const invalid = serverError !== undefined || status.kind === "problem"
    || (status.kind === "result" && (status.result === "TAKEN" || status.result === "INVALID"));

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>User ID</Label>
      <div className="relative">
        <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
          @
        </span>
        <Input
          id={id}
          name={name}
          value={value}
          onChange={(event) => {
            // The "@" is already shown in front of the field.
            setValue(event.target.value.replace(/^\s*@+/u, ""));
            setEditedAfter(errors);
          }}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={33}
          placeholder="your_id"
          className={cn("pl-9", inputClassName)}
          aria-invalid={invalid}
          aria-describedby={describedBy(hintId, statusId, serverError !== undefined && errorId)}
        />
      </div>
      <p id={hintId} className="text-sm text-muted-foreground">
        Other players find you with it, like a Telegram username. Use 5–32 letters, numbers or underscores, starting with a letter.
      </p>
      <p id={statusId} aria-live="polite" className={cn("min-h-5 text-sm", invalid ? "text-destructive" : "text-muted-foreground")}>
        {serverError === undefined && statusText(status)}
      </p>
      <FieldError id={errorId} messages={serverError === undefined ? undefined : [serverError]} />
    </div>
  );
}

function statusText(status: Status): string {
  switch (status.kind) {
    case "idle":
      return "";
    case "checking":
      return "Checking…";
    case "current":
      return "This is your current user ID.";
    case "problem":
      return status.message;
    case "result":
      if (status.result === "AVAILABLE") return `@${status.handle} is available.`;
      if (status.result === "TAKEN") return `@${status.handle} is taken. Try another.`;
      if (status.result === "INVALID") return "This user ID isn't allowed.";
      return "We couldn't check this ID now. We'll check again when you save.";
  }
}
