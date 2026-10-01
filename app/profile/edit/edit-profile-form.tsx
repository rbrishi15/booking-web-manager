"use client";

import { useActionState, useTransition } from "react";
import { describedBy, FieldError } from "@/app/(auth)/_components/field-error";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile, type ProfileState } from "../actions";

const initialState: ProfileState = { status: "idle" };

interface EditProfileFormProps {
  readonly initial: {
    readonly displayName: string;
    readonly preferredSports: readonly string[];
    readonly preferredRegions: readonly string[];
  };
}

/** UC1-03 Manage Profile form: name plus one or more sports and regions (REQ-3, REQ-4). */
export function EditProfileForm({ initial }: EditProfileFormProps) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState);
  const [, startTransition] = useTransition();
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  // Submit without React's automatic form reset, so the ticks stay as the user left them.
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // already saving: ignore a second Enter/click
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {state.status === "error" && state.message !== undefined && <ErrorMessage>{state.message}</ErrorMessage>}
      {state.status === "saved" && (
        <InfoNote icon>
          <span role="status">{state.message}</span>
        </InfoNote>
      )}

      <div className="space-y-2">
        <Label htmlFor="displayName">Name</Label>
        <Input
          id="displayName"
          name="displayName"
          autoComplete="name"
          defaultValue={initial.displayName}
          aria-invalid={errors.displayName !== undefined}
          aria-describedby={describedBy(errors.displayName !== undefined && "displayName-error")}
        />
        <FieldError id="displayName-error" messages={errors.displayName} />
      </div>

      <ChoiceGroup
        name="preferredSports"
        legend="Preferred sports"
        options={SPORTS}
        selected={initial.preferredSports}
        errors={errors.preferredSports}
      />

      <ChoiceGroup
        name="preferredRegions"
        legend="Preferred regions"
        options={REGIONS}
        selected={initial.preferredRegions}
        errors={errors.preferredRegions}
      />

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

interface ChoiceGroupProps {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly string[];
  readonly selected: readonly string[];
  readonly errors?: string[];
}

/** A set of tickable pills. Each ticked pill is sent with the form under the same name. */
function ChoiceGroup({ name, legend, options, selected, errors }: ChoiceGroupProps) {
  const errorId = `${name}-error`;

  return (
    <fieldset
      className="space-y-2"
      aria-invalid={errors !== undefined}
      aria-describedby={describedBy(errors !== undefined && errorId)}
    >
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-sm text-muted-foreground">Choose one or more.</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="checkbox"
              name={name}
              value={option}
              defaultChecked={selected.includes(option)}
              className="peer sr-only"
            />
            <span className="inline-flex items-center rounded-full border bg-card px-4 py-2 text-sm transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
              {option}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={errorId} messages={errors} />
    </fieldset>
  );
}