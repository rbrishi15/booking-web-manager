export const SESSION_API_UNAVAILABLE_MESSAGE = "Session creation is not available yet";

/** Intentional availability state while authentication and persistence await integration. */
export class SessionApiUnavailableError extends Error {
  constructor() {
    super(SESSION_API_UNAVAILABLE_MESSAGE);
    this.name = "SessionApiUnavailableError";
  }
}
