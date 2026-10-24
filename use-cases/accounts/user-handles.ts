import { UserHandle } from "@/domain/accounts/user-handle";
import { DomainError } from "@/domain/shared/errors";
import type { UUID } from "@/domain/shared/types";

/** What a signed-in player may see about someone found by user ID. */
export interface UserSummary {
  readonly userId: UUID;
  readonly handle: string;
  readonly displayName: string;
}

/** Reads user IDs. lib/supabase/postgres-user-directory.ts provides the real one. */
export interface UserDirectory {
  /** True when no account, active or not, holds this user ID. */
  isHandleFree(handle: UserHandle): Promise<boolean>;
  /** The ACTIVE account holding exactly this user ID, or null. */
  findActiveByHandle(handle: UserHandle): Promise<UserSummary | null>;
}

export type HandleAvailability = "AVAILABLE" | "TAKEN" | "INVALID";

/** UC1-01/UC1-03: tells someone choosing a user ID whether they can have it. */
export class CheckUserHandle {
  constructor(private readonly directory: Pick<UserDirectory, "isHandleFree">) {}

  async availability(input: string): Promise<HandleAvailability> {
    const handle = parseOrNull(input);
    if (handle === null) return "INVALID";
    return (await this.directory.isHandleFree(handle)) ? "AVAILABLE" : "TAKEN";
  }
}

/** Finds an active player by their exact user ID, as typing @name does in Telegram. */
export class FindUserByHandle {
  constructor(private readonly directory: Pick<UserDirectory, "findActiveByHandle">) {}

  /** Throws INVALID_INPUT for a malformed ID and NOT_FOUND when nobody active holds it. */
  async forHandle(input: string): Promise<UserSummary> {
    const handle = UserHandle.parse(input);
    const user = await this.directory.findActiveByHandle(handle);
    if (user === null) throw new DomainError("NOT_FOUND", "No player has this user ID");
    return user;
  }
}

function parseOrNull(input: string): UserHandle | null {
  try {
    return UserHandle.parse(input);
  } catch (error) {
    if (error instanceof DomainError && error.code === "INVALID_INPUT") return null;
    throw error;
  }
}
