import { DomainError } from "../shared/errors";

export const USER_HANDLE_MIN_LENGTH = 5;
export const USER_HANDLE_MAX_LENGTH = 32;

/**
 * Telegram's username rules: 5-32 characters of a-z, 0-9 and underscores,
 * starting with a letter, with no trailing or repeated underscore.
 */
const USER_HANDLE_PATTERN = /^[a-z](?!.*__)[a-z0-9_]{3,30}[a-z0-9]$/u;

/**
 * The public ID other players search for (ADR-0021). It is unique ignoring case,
 * so it is stored and compared in lower case and shown with a leading "@".
 * It is separate from the internal user UUID and can change.
 */
export class UserHandle {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  /** Accepts what a person types: surrounding spaces, one leading "@" and any letter case. */
  static parse(input: string): UserHandle {
    const trimmed = input.trim();
    const value = (trimmed.startsWith("@") ? trimmed.slice(1) : trimmed).toLowerCase();
    DomainError.require(
      USER_HANDLE_PATTERN.test(value),
      "INVALID_INPUT",
      "A user ID must have 5-32 letters, numbers or underscores, start with a letter, and not end with or repeat an underscore",
    );
    return new UserHandle(value);
  }

  /** The stored form, without "@". */
  toString(): string {
    return this.#value;
  }

  /** How the ID is shown to people. */
  toDisplay(): string {
    return `@${this.#value}`;
  }

  equals(other: UserHandle): boolean {
    return this.#value === other.#value;
  }
}
