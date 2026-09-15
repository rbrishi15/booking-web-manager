import { DomainError, requireDomain } from "../shared/errors";
import type { GroupStatus } from "../shared/statuses";
import type { UUID } from "../shared/types";
import {
  GroupMembership,
  type GroupMembershipSnapshot,
} from "./group-membership";

export interface RegularGroupSnapshot {
  readonly groupId: UUID;
  readonly ownerId: UUID;
  readonly name: string;
  readonly invitationToken: string;
  readonly invitationActive: boolean;
  readonly status: GroupStatus;
  readonly memberships: readonly GroupMembershipSnapshot[];
}

export interface RegularGroupCreateProps {
  readonly groupId: UUID;
  readonly ownerId: UUID;
  readonly name: string;
  readonly invitationToken: string;
  readonly now: Date;
}

export type GroupJoinResult = "JOINED" | "ALREADY_MEMBER";

/** Group aggregate; all membership and invitation changes go through the owner. */
export class RegularGroup {
  readonly #groupId: UUID;
  readonly #ownerId: UUID;
  #name: string;
  #invitationToken: string;
  #invitationActive: boolean;
  #status: GroupStatus;
  #memberships: GroupMembership[];

  private constructor(snapshot: RegularGroupSnapshot) {
    this.#groupId = snapshot.groupId;
    this.#ownerId = snapshot.ownerId;
    this.#name = snapshot.name;
    this.#invitationToken = snapshot.invitationToken;
    this.#invitationActive = snapshot.invitationActive;
    this.#status = snapshot.status;
    this.#memberships = snapshot.memberships.map((membership) =>
      GroupMembership.reconstitute(membership),
    );
    this.validate();
  }

  static create(props: RegularGroupCreateProps): RegularGroup {
    validateId(props.groupId, "groupId");
    validateId(props.ownerId, "ownerId");
    validateName(props.name);
    validateToken(props.invitationToken);
    return new RegularGroup({
      groupId: props.groupId,
      ownerId: props.ownerId,
      name: props.name,
      invitationToken: props.invitationToken,
      invitationActive: true,
      status: "ACTIVE",
      memberships: [{ userId: props.ownerId, joinedAt: props.now }],
    });
  }

  static reconstitute(snapshot: RegularGroupSnapshot): RegularGroup {
    requireDomain(
      Array.isArray(snapshot.memberships),
      "INVALID_INPUT",
      "A group needs a membership roster",
    );
    return new RegularGroup({
      ...snapshot,
      memberships: [...snapshot.memberships],
    });
  }

  join(command: {
    readonly userId: UUID;
    readonly invitationToken: string;
    readonly now: Date;
  }): GroupJoinResult {
    requireDomain(
      this.#status === "ACTIVE",
      "INVALID_STATE",
      "An archived group cannot accept members",
    );
    validateId(command.userId, "userId");
    requireDomain(
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
      GroupMembership.create({ userId: command.userId, joinedAt: command.now }),
    ];
    return "JOINED";
  }

  removeMember(command: {
    readonly actorId: UUID;
    readonly userId: UUID;
  }): void {
    this.assertOwner(command.actorId);
    requireDomain(
      this.#status === "ACTIVE",
      "INVALID_STATE",
      "An archived group cannot change membership",
    );
    requireDomain(
      command.userId !== this.#ownerId,
      "OWNER_REMOVAL",
      "The group owner cannot be removed",
    );
    const index = this.#memberships.findIndex(
      (member) => member.userId === command.userId,
    );
    requireDomain(index >= 0, "NOT_FOUND", "The group member was not found");
    this.#memberships = this.#memberships.filter(
      (member) => member.userId !== command.userId,
    );
  }

  rename(command: { readonly actorId: UUID; readonly name: string }): void {
    this.assertOwner(command.actorId);
    requireDomain(
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
    requireDomain(
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
    requireDomain(
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
    requireDomain(
      Number.isSafeInteger(command.unsettledLinkedSessions) &&
        command.unsettledLinkedSessions >= 0,
      "INVALID_INPUT",
      "Unsettled session count must be nonnegative",
    );
    requireDomain(
      command.unsettledLinkedSessions === 0,
      "ACTIVE_OBLIGATIONS",
      "The group has unsettled linked sessions",
    );
    this.#status = "ARCHIVED";
    this.#invitationActive = false;
  }

  snapshot(): RegularGroupSnapshot {
    return {
      groupId: this.#groupId,
      ownerId: this.#ownerId,
      name: this.#name,
      invitationToken: this.#invitationToken,
      invitationActive: this.#invitationActive,
      status: this.#status,
      memberships: this.#memberships.map((membership) => membership.snapshot()),
    };
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
    return this.#memberships.map((membership) =>
      GroupMembership.reconstitute(membership.snapshot()),
    );
  }

  private assertOwner(actorId: UUID): void {
    requireDomain(
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
    requireDomain(
      this.#status === "ACTIVE" || this.#status === "ARCHIVED",
      "INVALID_INPUT",
      "Unknown group status",
    );
    requireDomain(
      typeof this.#invitationActive === "boolean",
      "INVALID_INPUT",
      "invitationActive must be boolean",
    );
    requireDomain(
      this.#memberships.length > 0,
      "INVALID_INPUT",
      "A group must retain at least one member",
    );
    const ids = new Set(
      this.#memberships.map((membership) => membership.userId),
    );
    requireDomain(
      ids.size === this.#memberships.length,
      "DUPLICATE_ID",
      "A user may only have one group membership",
    );
    requireDomain(
      ids.has(this.#ownerId),
      "INVALID_INPUT",
      "The group owner must be a member",
    );
    if (this.#status === "ARCHIVED")
      requireDomain(
        !this.#invitationActive,
        "INVALID_INPUT",
        "An archived group cannot have an active invitation",
      );
  }
}

function validateId(value: string, name: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
function validateName(value: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    "A group name is required",
  );
}
function validateToken(value: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    "An invitation token is required",
  );
}

export type RegularGroupProps = RegularGroupSnapshot;
