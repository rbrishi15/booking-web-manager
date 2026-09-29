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