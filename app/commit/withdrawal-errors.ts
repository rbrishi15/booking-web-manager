import type { ActionError } from "./withdrawal-ports";

/**
 * A failed withdrawal or waitlist departure, thrown so React Query treats it as an error. Keeps the
 * API's code and whether the action may still have happened (`unconfirmed`).
 */
export class SessionActionError extends Error {
  readonly code: string;
  readonly unconfirmed: boolean;

  constructor(failure: ActionError) {
    super(failure.message);
    this.name = "SessionActionError";
    this.code = failure.code;
    this.unconfirmed = failure.unconfirmed;
  }
}

/** The refund preview could not be loaded; the message is shown to the player. */
export class PreviewUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewUnavailableError";
  }
}
