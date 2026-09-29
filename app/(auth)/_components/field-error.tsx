interface FieldErrorProps {
  /** Matches the input's aria-describedby, so screen readers read the error with the field. */
  readonly id: string;
  readonly messages?: readonly string[];
}

/** Red message under a form field, e.g. "Enter a valid email address". Renders nothing when valid. */
export function FieldError({ id, messages }: FieldErrorProps) {
  const message = messages?.[0];
  if (message === undefined) return null;

  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * Builds an aria-describedby value from only the ids whose elements are on screen,
 * e.g. describedBy(hasError && "email-error"). Returns undefined when there are none.
 */
export function describedBy(...ids: ReadonlyArray<string | false | undefined>): string | undefined {
  const present = ids.filter((id): id is string => typeof id === "string" && id !== "");
  return present.length > 0 ? present.join(" ") : undefined;
}