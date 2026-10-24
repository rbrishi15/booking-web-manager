import { prepareProfileUpdate, type ProfileChanges } from "@/domain/accounts/profile";
import { UserHandle } from "@/domain/accounts/user-handle";
import { DomainError } from "@/domain/shared/errors";
import type { AccountStatus } from "@/domain/shared/statuses";
import type { UUID } from "@/domain/shared/types";

/** A profile edit; a missing handle leaves the current user ID unchanged. */
export interface ProfileEdit extends ProfileChanges {
  readonly handle?: string;
}

/** Validated changes. handle is the stored lower-case form when the edit sets one. */
export interface ProfileUpdate extends ProfileChanges {
  readonly handle?: string;
}

export interface ProfileStore {
  getAccountStatus(userId: UUID): Promise<AccountStatus | null>;
  /**
   * Recheck ACTIVE atomically with the write; deactivation may follow the initial read.
   * Throws DomainError HANDLE_TAKEN when another account already has the user ID.
   */
  saveForActiveUser(userId: UUID, changes: ProfileUpdate): Promise<void>;
}

/** UC1-03: apply the profile policy and persist only this user's editable fields. */
export class UpdateProfile {
  constructor(private readonly profiles: ProfileStore) {}

  async forUser(userId: UUID, input: ProfileEdit): Promise<void> {
    const status = await this.profiles.getAccountStatus(userId);
    if (status === null) throw new DomainError("NOT_FOUND", "The profile was not found");
    const changes = prepareProfileUpdate(status, input);
    const update: ProfileUpdate = input.handle === undefined
      ? changes
      : { ...changes, handle: UserHandle.parse(input.handle).toString() };
    await this.profiles.saveForActiveUser(userId, update);
  }
}
