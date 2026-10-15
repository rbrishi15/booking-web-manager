"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  completeEmail,
  editEmail,
  EMAIL_ENDINGS,
  normalizeEmail,
  selectEmailEnding,
  type EmailEnding,
  type EmailInputValue,
} from "./email-input-value";
import styles from "./email-input.module.css";

type EmailInputProps = Omit<React.ComponentProps<"input">, "name" | "type" | "value" | "defaultValue" | "onChange">;

/** A single email control with an optional ending, while preserving full-address entry. */
export function EmailInput({ className, onBlur, disabled, ...props }: EmailInputProps) {
  const [value, setValue] = useState<EmailInputValue>({ mode: "split", address: "", ending: ".com" });

  return (
    <div className={cn(styles.control, className)} aria-invalid={props["aria-invalid"]}>
      <Input
        autoComplete="email"
        inputMode="email"
        placeholder="example@vorterlune"
        {...props}
        type="email"
        className={styles.address}
        disabled={disabled}
        value={value.address}
        onChange={(event) => setValue((current) => editEmail(current, event.target.value))}
        onBlur={(event) => {
          setValue((current) => normalizeEmail(current));
          onBlur?.(event);
        }}
      />
      <div className={styles.ending}>
        <select
          aria-label="Email ending"
          aria-describedby={props["aria-describedby"]}
          disabled={disabled}
          value={value.mode === "split" ? value.ending : ""}
          onChange={(event) => {
            const ending = event.target.value;
            if (ending === "" || EMAIL_ENDINGS.includes(ending as EmailEnding)) {
              setValue((current) => selectEmailEnding(current, ending as EmailEnding | ""));
            }
          }}
        >
          {EMAIL_ENDINGS.map((ending) => <option key={ending} value={ending}>{ending}</option>)}
          <option value="">Other</option>
        </select>
        <ChevronDown aria-hidden="true" />
      </div>
      <input type="hidden" name="email" value={completeEmail(value)} disabled={disabled} />
    </div>
  );
}
