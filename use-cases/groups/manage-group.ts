import { DomainError, RegularGroup, type GroupJoinResult, type UUID } from "@/domain";
import type { Repository } from "../shared/contracts";

/** Group lookups that the plain get/save Repository contract doesn't cover. */
export interface GroupQueries {
  findByInvitationToken(token: string): Promise<RegularGroup | null>;
  /** Every group the user belongs to (owned or joined). */
  listForMember(userId: UUID): Promise<readonly RegularGroup[]>;
  /** Sessions invited from this group that are not settled yet; archiving waits for these. */
  countUnsettledLinkedSessions(groupId: UUID): Promise<number>;
}

/**
 * Someone else saved the group after this request read it, so saving would overwrite their change.
 * Each store reports its own conflict signal (Supabase: SQLSTATE 40001) as this error.
 */
export class GroupChangedError extends Error {
  constructor() {
    super("The group was changed by someone else. Refresh the page and try again.");
    this.name = "GroupChangedError";
  }
}


export interface ManageGroupDependencies {
  /**
   * `groups` and `queries` must come from the same store: a group loaded through either one
   * is saved through `groups`, and the store remembers which version it loaded.
   */
  readonly groups: Repository<RegularGroup>;
  readonly queries: GroupQueries;
  readonly newId: () => UUID;
  /** A long random value that is hard to guess; it becomes the invitation link. */
  readonly newInvitationToken: () => string;
  readonly now: () => Date;
}

/**
 * UC1-06 Manage Group: create a regular group, share and control its invitation link,
 * and manage its members. RegularGroup (Rishi's domain) enforces the rules, such as
 * "only the owner may remove members" and "the owner can't be removed"; this class
 * loads the group, asks it to act, and saves it.
 */
export class ManageGroup {
  readonly #deps: ManageGroupDependencies;

  constructor(deps: ManageGroupDependencies) {
    this.#deps = deps;
  }

  /** Creates a group owned by (and containing) the creator, with an active invitation link. */
  async create(command: { readonly ownerId: UUID; readonly name: string }): Promise<RegularGroup> {
    const group = RegularGroup.create({
      groupId: this.#deps.newId(),
      ownerId: command.ownerId,
      name: command.name,
      invitationToken: this.#deps.newInvitationToken(),
      now: this.#deps.now(),
    });
    await this.#deps.groups.save(group);
    return group;
  }

  /**
   * The groups shown on the signed-in user's Groups page. There is no user to choose:
   * it lists only groups the actor belongs to, and the actor comes from the session.
   */
  async listMine(command: { readonly actorId: UUID }): Promise<readonly RegularGroup[]> {
    return this.#deps.queries.listForMember(command.actorId);
  }

  /** One group's details, for its members only. Non-members get NOT_FOUND so they learn nothing. */
  async viewAsMember(command: { readonly actorId: UUID; readonly groupId: UUID }): Promise<RegularGroup> {
    const group = await this.#deps.groups.get(command.groupId);
    const isMember = group?.memberships.some((member) => member.userId === command.actorId) ?? false;
    if (group === null || !isMember) throw new DomainError("NOT_FOUND", "The group was not found");
    return group;
  }

  /** The group behind an invitation link, so the join page can show its name before joining. */
  async previewInvitation(token: string): Promise<RegularGroup> {
    const group = await this.#deps.queries.findByInvitationToken(token);
    if (group === null || !group.invitationActive || group.status !== "ACTIVE") {
      throw new DomainError("INVALID_INVITATION", "The invitation token is invalid or revoked");
    }
    return group;
  }

  /** Joins through an invitation link. Joining twice is harmless: the result is ALREADY_MEMBER. */
  async join(command: {
    readonly userId: UUID;
    readonly invitationToken: string;
  }): Promise<{ readonly group: RegularGroup; readonly result: GroupJoinResult }> {
    const group = await this.#deps.queries.findByInvitationToken(command.invitationToken);
    if (group === null) throw new DomainError("INVALID_INVITATION", "The invitation token is invalid or revoked");

    const result = group.join({
      userId: command.userId,
      invitationToken: command.invitationToken,
      now: this.#deps.now(),
    });
    if (result === "JOINED") await this.#deps.groups.save(group);
    return { group, result };
  }

  /** Owner only: removes a member (never the owner). */
  async removeMember(command: {
    readonly actorId: UUID;
    readonly groupId: UUID;
    readonly userId: UUID;
  }): Promise<void> {
    const group = await this.#load(command.groupId);
    group.removeMember({ actorId: command.actorId, userId: command.userId });
    await this.#deps.groups.save(group);
  }

  /** Owner only: renames the group. */
  async rename(command: { readonly actorId: UUID; readonly groupId: UUID; readonly name: string }): Promise<void> {
    const group = await this.#load(command.groupId);
    group.rename({ actorId: command.actorId, name: command.name });
    await this.#deps.groups.save(group);
  }

  /** Owner only: issues a new link. The old link stops working. Returns the new token. */
  async rotateInvitation(command: { readonly actorId: UUID; readonly groupId: UUID }): Promise<string> {
    const group = await this.#load(command.groupId);
    group.rotateInvitation({ actorId: command.actorId, invitationToken: this.#deps.newInvitationToken() });
    await this.#deps.groups.save(group);
    return group.invitationToken;
  }

  /** Owner only: turns the invitation link off until a new one is issued. */
  async revokeInvitation(command: { readonly actorId: UUID; readonly groupId: UUID }): Promise<void> {
    const group = await this.#load(command.groupId);
    group.revokeInvitation(command.actorId);
    await this.#deps.groups.save(group);
  }

  /** Owner only: archives the group once none of its sessions are still unsettled. */
  async archive(command: { readonly actorId: UUID; readonly groupId: UUID }): Promise<void> {
    const group = await this.#load(command.groupId);
    const unsettledLinkedSessions = await this.#deps.queries.countUnsettledLinkedSessions(command.groupId);
    group.archive({ actorId: command.actorId, unsettledLinkedSessions });
    await this.#deps.groups.save(group);
  }

  async #load(groupId: UUID): Promise<RegularGroup> {
    const group = await this.#deps.groups.get(groupId);
    if (group === null) throw new DomainError("NOT_FOUND", "The group was not found");
    return group;
  }
}