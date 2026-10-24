import type { UUID } from "@/domain";
import type { CheckUserHandle, FindUserByHandle } from "@/use-cases/accounts/user-handles";

export const USER_HANDLES_UNAVAILABLE_MESSAGE = "User IDs are not available right now";

/** The server has no database settings, so user IDs cannot be checked or looked up. */
export class UserHandlesUnavailableError extends Error {
  constructor() {
    super(USER_HANDLES_UNAVAILABLE_MESSAGE);
    this.name = "UserHandlesUnavailableError";
  }
}

/** App-owned capabilities for choosing and finding user IDs (UC1-01, UC1-03; ADR-0021). */
export interface UserHandleDependencies {
  readonly authenticate: (request: Request) => Promise<UUID | null>;
  readonly checkUserHandle: Pick<CheckUserHandle, "availability">;
  readonly findUserByHandle: Pick<FindUserByHandle, "forHandle">;
}
