export const DISCOVERY_API_UNAVAILABLE_MESSAGE = "Session discovery is not available yet";

export class DiscoveryApiUnavailableError extends Error {
  constructor() {
    super(DISCOVERY_API_UNAVAILABLE_MESSAGE);
    this.name = "DiscoveryApiUnavailableError";
  }
}
