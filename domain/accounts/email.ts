import { requireDomain } from "../shared/errors";

/** An immutable email address with basic syntax validation and exact-text equality. */
export class Email {
  readonly #value: string;

  constructor(value: string) {
    requireDomain(
      typeof value === "string" &&
        !/\s/u.test(value) &&
        /^[^@]+@[^@]+$/u.test(value),
      "INVALID_INPUT",
      "A valid email is required",
    );
    this.#value = value;
    Object.freeze(this);
  }

  toString(): string {
    return this.#value;
  }

  equals(other: Email): boolean {
    requireDomain(
      other instanceof Email,
      "INVALID_INPUT",
      "Email comparison requires another Email",
    );
    return this.#value === other.#value;
  }
}
