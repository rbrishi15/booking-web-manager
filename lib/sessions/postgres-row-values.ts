import { z } from "zod";

export class SessionPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionPersistenceError";
  }
}

export function text(value: unknown): string {
  return z.string().min(1).parse(value);
}
export function optionalText(value: unknown): string | undefined {
  return value === null ? undefined : text(value);
}
export function strings(value: unknown): string[] {
  return z.array(z.string().min(1)).parse(value);
}
export function choice<const T extends readonly [string, ...string[]]>(
  value: unknown,
  values: T,
): T[number] {
  return z.enum(values).parse(value);
}
export function date(value: unknown): Date {
  return z.date().parse(value);
}
export function optionalDate(value: unknown): Date | undefined {
  return value === null ? undefined : date(value);
}
export function optionalInteger(value: unknown): number | undefined {
  return value === null ? undefined : z.number().int().safe().parse(value);
}
