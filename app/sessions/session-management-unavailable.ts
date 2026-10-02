export const SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE = "Session management is not available yet";

export class SessionManagementUnavailableError extends Error {
  constructor() {
    super(SESSION_MANAGEMENT_UNAVAILABLE_MESSAGE);
    this.name = "SessionManagementUnavailableError";
  }
}
