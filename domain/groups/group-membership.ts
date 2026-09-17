import { copyDate } from "../shared/date";
import { requireDomain } from "../shared/errors";
import type { UUID } from "../shared/types";

export interface GroupMembershipDetails {
  readonly userId: UUID;
  readonly joinedAt: Date;
}

/**
 * Immutable child entity of the RegularGroup aggregate root.
 * Membership is added or removed through RegularGroup commands, which enforce
 * roster-wide rules such as uniqueness and retaining the group's owner.
 */
export class GroupMembership {
  readonly #userId: UUID;
  readonly #joinedAt: Date;

  constructor(details: GroupMembershipDetails) {
    requireDomain(
      typeof details.userId === "string" && details.userId.trim() !== "",
      "INVALID_INPUT",
      "A membership needs a user ID",
    );
    requireDomain(
      details.joinedAt instanceof Date &&
        Number.isFinite(details.joinedAt.getTime()),
      "INVALID_INPUT",
      "joinedAt must be a valid Date",
    );

    this.#userId = details.userId;
    this.#joinedAt = copyDate(details.joinedAt, "joinedAt");
  }

  get userId(): UUID {
    return this.#userId;
  }
  get joinedAt(): Date {
    return copyDate(this.#joinedAt, "joinedAt");
  }
}
