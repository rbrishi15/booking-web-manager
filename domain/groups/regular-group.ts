import { DomainError } from "../shared/errors";
import type { GroupStatus } from "../shared/statuses";
import type { UUID } from "../shared/types";
import { GroupMembership } from "./group-membership";

export interface RegularGroupDetails {
  readonly groupId: UUID;
  readonly ownerId: UUID;
  readonly name: string;
  readonly invitationToken: string;
  readonly invitationActive: boolean;
  readonly status: GroupStatus;
  readonly memberships: readonly GroupMembership[];
}

export interface GroupCreation {
  readonly groupId: UUID;
  readonly ownerId: UUID;
  readonly name: string;
  readonly invitationToken: string;
  readonly now: Date;
}

export type GroupJoinResult = "JOINED" | "ALREADY_MEMBER";

/**
 * Aggregate root: RegularGroup.
 * Owns GroupMembership children, group details, and invitation/archive state.
 * Membership and invitation commands enter through this root so it can enforce
 * unique membership, retain the owner, and check invitation or owner authority.
 * Referenced users and sessions belong to separate aggregates.
 * See docs/adr/0003-aggregate-roots-and-boundaries.md.
 */
export class RegularGroup {
  readonly #groupId: UUID;
  readonly #ownerId: UUID;
  #name: string;
  #invitationToken: string;
  #invitationActive: boolean;
  #status: GroupStatus;
  #memberships: GroupMembership[];

  constructor(details: RegularGroupDetails) {
    DomainError.require(
      Array.isArray(details.memberships),
      "INVALID_INPUT",
      "A group needs a membership roster",
    );

    this.#groupId = details.groupId;
    this.#ownerId = details.ownerId;
    this.#name = details.name;
    this.#invitationToken = details.invitationToken;
    this.#invitationActive = details.invitationActive;
    this.#status = details.status;
    this.#memberships = [...details.memberships];
    this.validate();
  }

  static create(details: GroupCreation): RegularGroup {
    return new RegularGroup({
      groupId: details.groupId,
      ownerId: details.ownerId,
      name: details.name,
      invitationToken: details.invitationToken,
      invitationActive: true,
      status: "ACTIVE",
      memberships: [
        new GroupMembership({ userId: details.ownerId, joinedAt: details.now }),
      ],
    });
  }

  join(command: {
    readonly userId: UUID;
    readonly invitationToken: string;
    readonly now: Date;
  }): GroupJoinResult {
    DomainError.require(
      this.#status === "ACTIVE",
      "INVALID_STATE",
      "An archived group cannot accept members",
    );
    validateId(command.userId, "userId");
    DomainError.require(
      this.#invitationActive &&
        command.invitationToken === this.#invitationToken,
      "INVALID_INVITATION",
      "The invitation token is invalid or revoked",
    );
    const existing = this.#memberships.some(
      (member) => member.userId === command.userId,
    );
    if (existing) return "ALREADY_MEMBER";
    this.#memberships = [
      ...this.#memberships,
      new GroupMembership({ userId: command.userId, joinedAt: command.now }),
    ];
    return "JOINED";
  }

  removeMember(command: {
    readonly actorId: UUID;
    readonly userId: UUID;
  }): void {
    this.assertOwner(command.actorId);
    DomainError.require(
      this.#status === "ACTIVE",
      "INVALID_STATE",
      "An archived group cannot change membership",
    );
    DomainError.require(
      command.userId !== this.#ownerId,
      "OWNER_REMOVAL",
      "The group owner cannot be removed",
    );
    const index = this.#memberships.findIndex(
      (member) => member.userId === command.userId,
    );
    DomainError.require(index >= 0, "NOT_FOUND", "The group member was not found");
    this.#memberships = this.#memberships.filter(
      (member) => member.userId !== command.userId,
    );
  }

  rename(command: { readonly actorId: UUID; readonly name: string }): void {
    this.assertOwner(command.actorId);
    DomainError.require(
      this.#status === "ACTIVE",
      "INVALID_STATE",
      "An archived group cannot be renamed",
    );
    validateName(command.name);
    this.#name = command.name;
  }

  rotateInvitation(command: {
    readonly actorId: UUID;
    readonly invitationToken: string;
  }): void {
    this.assertOwner(command.actorId);
    DomainError.require(
      this.#status === "ACTIVE",
      "INVALID_STATE",
      "An archived group cannot rotate invitations",
    );
    validateToken(command.invitationToken);
    this.#invitationToken = command.invitationToken;
    this.#invitationActive = true;
  }

  revokeInvitation(actorId: UUID): void {
    this.assertOwner(actorId);
    DomainError.require(
      this.#status === "ACTIVE",
      "INVALID_STATE",
      "An archived group cannot revoke invitations",
    );
    this.#invitationActive = false;
  }

  archive(command: {
    readonly actorId: UUID;
    readonly unsettledLinkedSessions: number;
  }): void {
    this.assertOwner(command.actorId);
    if (this.#status === "ARCHIVED") return;
    DomainError.require(
      Number.isSafeInteger(command.unsettledLinkedSessions) &&
        command.unsettledLinkedSessions >= 0,
      "INVALID_INPUT",
      "Unsettled session count must be nonnegative",
    );
    DomainError.require(
      command.unsettledLinkedSessions === 0,
      "ACTIVE_OBLIGATIONS",
      "The group has unsettled linked sessions",
    );
    this.#status = "ARCHIVED";
    this.#invitationActive = false;
  }

  get groupId(): UUID {
    return this.#groupId;
  }
  get ownerId(): UUID {
    return this.#ownerId;
  }
  get name(): string {
    return this.#name;
  }
  get invitationToken(): string {
    return this.#invitationToken;
  }
  get invitationActive(): boolean {
    return this.#invitationActive;
  }
  get status(): GroupStatus {
    return this.#status;
  }
  get memberships(): readonly GroupMembership[] {
    return [...this.#memberships];
  }

  private assertOwner(actorId: UUID): void {
    DomainError.require(
      actorId === this.#ownerId,
      "UNAUTHORIZED",
      "Only the group owner may perform this action",
    );
  }

  private validate(): void {
    validateId(this.#groupId, "groupId");
    validateId(this.#ownerId, "ownerId");
    validateName(this.#name);
    validateToken(this.#invitationToken);
    DomainError.require(
      this.#status === "ACTIVE" || this.#status === "ARCHIVED",
      "INVALID_INPUT",
      "Unknown group status",
    );
    DomainError.require(
      this.#memberships.length > 0,
      "INVALID_INPUT",
      "A group must retain at least one member",
    );
    const ids = new Set(
      this.#memberships.map((membership) => membership.userId),
    );
    DomainError.require(
      ids.size === this.#memberships.length,
      "DUPLICATE_ID",
      "A user may only have one group membership",
    );
    DomainError.require(
      ids.has(this.#ownerId),
      "INVALID_INPUT",
      "The group owner must be a member",
    );
    if (this.#status === "ARCHIVED")
      DomainError.require(
        !this.#invitationActive,
        "INVALID_INPUT",
        "An archived group cannot have an active invitation",
      );
  }
}

function validateId(value: string, name: string): void {
  DomainError.require(
    value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
function validateName(value: string): void {
  DomainError.require(
    value.trim() !== "",
    "INVALID_INPUT",
    "A group name is required",
  );
}
function validateToken(value: string): void {
  DomainError.require(
    value.trim() !== "",
    "INVALID_INPUT",
    "An invitation token is required",
  );
}
