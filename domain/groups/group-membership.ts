import { copyDate } from "../shared/date";
import { requireDomain } from "../shared/errors";
import type { UUID } from "../shared/types";

export interface GroupMembershipSnapshot {
  readonly userId: UUID;
  readonly joinedAt: Date;
}

/** Immutable membership owned by a RegularGroup aggregate. */
export class GroupMembership {
  readonly #snapshot: GroupMembershipSnapshot;

  private constructor(snapshot: GroupMembershipSnapshot) {
    this.#snapshot = Object.freeze({
      userId: snapshot.userId,
      joinedAt: copyDate(snapshot.joinedAt, "joinedAt"),
    });
  }

  static create(details: GroupMembershipSnapshot): GroupMembership {
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
    return new GroupMembership(details);
  }

  static reconstitute(snapshot: GroupMembershipSnapshot): GroupMembership {
    return GroupMembership.create(snapshot);
  }

  snapshot(): GroupMembershipSnapshot {
    return { userId: this.userId, joinedAt: this.joinedAt };
  }

  get userId(): UUID {
    return this.#snapshot.userId;
  }
  get joinedAt(): Date {
    return copyDate(this.#snapshot.joinedAt, "joinedAt");
  }
}
