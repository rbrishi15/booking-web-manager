/** Copy a valid instant instead of retaining a caller's mutable Date. */
export function copyDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError(`${name} must be a valid Date`);
  }
  return new Date(value.getTime());
}

export function copyOptionalDate(
  value: Date | undefined,
  name: string,
): Date | undefined {
  return value === undefined ? undefined : copyDate(value, name);
}
