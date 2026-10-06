export const SESSION_REMOVAL_UNAVAILABLE_MESSAGE = "Participant removal is not available yet";

export class SessionRemovalUnavailableError extends Error {
  constructor() {
    super(SESSION_REMOVAL_UNAVAILABLE_MESSAGE);
    this.name = "SessionRemovalUnavailableError";
  }
}
