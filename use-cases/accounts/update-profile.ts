import { prepareProfileUpdate, type ProfileChanges } from "@/domain/accounts/profile";
import { DomainError } from "@/domain/shared/errors";
import type { AccountStatus } from "@/domain/shared/statuses";
import type { UUID } from "@/domain/shared/types";

export interface ProfileStore {
  getAccountStatus(userId: UUID): Promise<AccountStatus | null>;
  /** Recheck ACTIVE atomically with the write; deactivation may follow the initial read. */
  saveForActiveUser(userId: UUID, changes: ProfileChanges): Promise<void>;
}

/** UC1-03: apply the profile policy and persist only this user's editable fields. */
export class UpdateProfile {
  constructor(private readonly profiles: ProfileStore) {}

  async forUser(userId: UUID, input: ProfileChanges): Promise<void> {
    const status = await this.profiles.getAccountStatus(userId);
    if (status === null) throw new DomainError("NOT_FOUND", "The profile was not found");
    const changes = prepareProfileUpdate(status, input);
    await this.profiles.saveForActiveUser(userId, changes);
  }
}
