export const SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE = "Session management is not available yet";

export class SessionManagementUnavailableError extends Error {
  /** Creates the public error used when session management dependencies are unavailable. */
  constructor() {
    super(SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE);
    this.name = "SessionManagementUnavailableError";
  }
}
