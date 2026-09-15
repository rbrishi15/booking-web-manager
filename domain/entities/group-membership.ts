import { requireDomain } from "../errors";
import { copyDate } from "../internal/date";
import type { UUID } from "../types";

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

  static create(props: GroupMembershipSnapshot): GroupMembership {
    requireDomain(
      typeof props.userId === "string" && props.userId.trim() !== "",
      "INVALID_INPUT",
      "A membership needs a user ID",
    );
    requireDomain(
      props.joinedAt instanceof Date &&
        Number.isFinite(props.joinedAt.getTime()),
      "INVALID_INPUT",
      "joinedAt must be a valid Date",
    );
    return new GroupMembership(props);
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

export type GroupMembershipProps = GroupMembershipSnapshot;
