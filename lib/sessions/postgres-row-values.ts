/** Corrupt persisted state is an infrastructure failure, not bad HTTP input. */
export class SessionPersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SessionPersistenceError";
  }
}

export function text(value: unknown, column: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SessionPersistenceError(`Invalid stored ${column}`);
  }
  return value;
}

export function optionalText(
  value: unknown,
  column: string,
): string | undefined {
  return value === null ? undefined : text(value, column);
}

export function date(value: unknown, column: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SessionPersistenceError(`Invalid stored ${column}`);
  }
  return new Date(value);
}

export function optionalDate(value: unknown, column: string): Date | undefined {
  return value === null ? undefined : date(value, column);
}

export function strings(value: unknown, column: string): string[] {
  if (!Array.isArray(value)) {
    throw new SessionPersistenceError(`Invalid stored ${column}`);
  }
  return value.map((entry: unknown) => text(entry, column));
}

export function choice<const T extends string>(
  value: unknown,
  column: string,
  choices: readonly T[],
): T {
  const selected = choices.find((entry) => entry === value);
  if (selected === undefined) {
    throw new SessionPersistenceError(`Invalid stored ${column}`);
  }
  return selected;
}

export function optionalInteger(
  value: unknown,
  column: string,
): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new SessionPersistenceError(`Invalid stored ${column}`);
  }
  return value;
}
