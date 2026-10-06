import { DomainError } from "../shared/errors";
import type { AccountStatus } from "../shared/statuses";

export const PROFILE_REGIONS = ["Central", "East", "North", "North-East", "West"] as const;
export const PROFILE_SPORTS = ["Badminton", "Basketball", "Football", "Futsal", "Tennis", "Volleyball"] as const;

export interface ProfileChanges {
  readonly displayName: string;
  readonly preferredSports: readonly string[];
  readonly preferredRegions: readonly string[];
}

/** Shared with User hydration; registration and anonymisation may have no preferences. */
export function assertValidPreferences(values: Iterable<string>, name: string): void {
  for (const value of values) {
    DomainError.require(value.trim() !== "", "INVALID_INPUT", `${name} contains an empty value`);
  }
}

/** UC1-03 edits use only profile facts, without constructing an incomplete User. */
export function prepareProfileUpdate(status: AccountStatus, changes: ProfileChanges): ProfileChanges {
  DomainError.require(status === "ACTIVE", "INACTIVE_ACCOUNT", "The account is inactive");
  const displayName = changes.displayName.trim();
  DomainError.require(displayName.length > 0 && displayName.length <= 60,
    "INVALID_INPUT", "A profile name must contain between 1 and 60 characters");
  assertValidPreferences(changes.preferredSports, "preferredSports");
  assertValidPreferences(changes.preferredRegions, "preferredRegions");
  DomainError.require(changes.preferredSports.length > 0 && changes.preferredSports.every((sport) =>
    PROFILE_SPORTS.some((allowed) => allowed === sport)), "INVALID_INPUT", "Choose at least one supported sport");
  DomainError.require(changes.preferredRegions.length > 0 && changes.preferredRegions.every((region) =>
    PROFILE_REGIONS.some((allowed) => allowed === region)), "INVALID_INPUT", "Choose at least one supported region");
  return {
    displayName,
    preferredSports: [...new Set(changes.preferredSports)],
    preferredRegions: [...new Set(changes.preferredRegions)],
  };
}
