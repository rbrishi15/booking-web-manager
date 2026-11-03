import { DomainError, type Session, type User, type UUID } from "@/domain";
import { UserHandle } from "@/domain/accounts/user-handle";
import type { NotificationIntent } from "@/use-cases/notifications/notification-intents";
import type { Clock } from "@/use-cases/shared/contracts";
import { requireAggregate } from "@/use-cases/shared/helpers";
import { requireParticipantListOwner } from "./participant-removal-preview";

export interface InvitablePlayer {
  readonly userId: UUID;
  readonly handle: string | null;
  readonly displayName: string;
}
export interface SessionInvite {
  readonly inviteeId: UUID;
  readonly displayName: string;
  readonly handle: string | null;
  readonly status: "PENDING" | "ACCEPTED" | "DECLINED";
  readonly invitedAt: Date;
}
export interface SessionInviteSummary {
  readonly invited: number;
  readonly alreadyInvited: number;
  readonly alreadyParticipating: number;
}
export interface SessionInvitationGroup {
  readonly groupId: UUID;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly InvitablePlayer[];
}

export interface SessionInvitationRepositories {
  readonly users: { get(userId: UUID): Promise<User | null> };
  readonly sessions: { get(sessionId: UUID): Promise<Session | null> };
  readonly recipients: {
    listGroups(hostId: UUID): Promise<readonly SessionInvitationGroup[]>;
    /** Exact user IDs. All recipients are active at the serializable read boundary. */
    byHandles(handles: readonly string[]): Promise<readonly InvitablePlayer[]>;
    /** Verifies the host is a current member of an ACTIVE group; denies stale/malicious selection. */
    fromGroup(hostId: UUID, groupId: UUID, selectedIds: readonly UUID[]): Promise<readonly InvitablePlayer[]>;
  };
  readonly invitations: {
    /** Unique (session, invitee), no duplicate notifications or accidental reissue. */
    add(sessionId: UUID, invitedBy: UUID, recipients: readonly InvitablePlayer[], groupId?: UUID): Promise<readonly UUID[]>;
    list(sessionId: UUID): Promise<readonly SessionInvite[]>;
  };
  readonly notifications: { append(notices: readonly NotificationIntent[]): Promise<void> };
}
export interface SessionInvitationTransaction {
  run<T>(work: (repositories: SessionInvitationRepositories) => Promise<T>): Promise<T>;
}

/**
 * UC2-03d: host-issued session invitations.
 *
 * A session invitation is NOT a Participation: accepting it uses UC2-04 and its
 * atomic wallet hold/waitlist policy. A host cannot debit another player's wallet.
 * The same serializable transaction authorizes the host, validates group
 * membership, inserts pending invitations and appends inbox notifications.
 */
export class ManageSessionInvitations {
  constructor(private readonly deps: {
    readonly transaction: SessionInvitationTransaction;
    readonly clock: Clock;
  }) {}

  private async withHost<T>(
    hostId: UUID,
    sessionId: UUID,
    work: (repositories: SessionInvitationRepositories, session: Session) => Promise<T>,
    mustBeUpcoming: boolean,
  ): Promise<T> {
    return this.deps.transaction.run(async (repos) => {
      const user = await requireAggregate(repos.users, hostId, "User");
      DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive host cannot manage invitations");
      const session = await requireAggregate(repos.sessions, sessionId, "Session");
      requireParticipantListOwner(user, session);
      if (mustBeUpcoming) {
        DomainError.require(session.status === "OPEN", "SESSION_CLOSED", "This session is closed for invitations");
        DomainError.require(session.booking.startAt > this.deps.clock.now(), "SESSION_STARTED", "This session has started");
      }
      return work(repos, session);
    });
  }

  async inviteByHandles(hostId: UUID, sessionId: UUID, rawHandles: readonly string[]): Promise<SessionInviteSummary> {
    DomainError.require(rawHandles.length > 0 && rawHandles.length <= 50, "INVALID_INPUT", "Select 1 to 50 players");
    const handles = rawHandles.map((value) => UserHandle.parse(value).toString());
    DomainError.require(new Set(handles).size === handles.length, "INVALID_INPUT", "User IDs must be unique");
    return this.withHost(hostId, sessionId, async (repos, session) => {
      const players = await repos.recipients.byHandles(handles);
      DomainError.require(players.length === handles.length, "NOT_FOUND", "One or more players could not be found");
      return this.issue(repos, session, hostId, players);
    }, true);
  }

  async inviteFromGroup(hostId: UUID, sessionId: UUID, groupId: UUID, userIds: readonly UUID[]): Promise<SessionInviteSummary> {
    DomainError.require(userIds.length > 0 && userIds.length <= 50, "INVALID_INPUT", "Select 1 to 50 group members");
    DomainError.require(new Set(userIds).size === userIds.length, "INVALID_INPUT", "Group members must be unique");
    return this.withHost(hostId, sessionId, async (repos, session) => {
      const players = await repos.recipients.fromGroup(hostId, groupId, userIds);
      DomainError.require(players.length === userIds.length, "UNAUTHORIZED", "Selected members must belong to one of your active groups");
      return this.issue(repos, session, hostId, players, groupId);
    }, true);
  }

  async listForBooker(hostId: UUID, sessionId: UUID): Promise<readonly SessionInvite[]> {
    return this.withHost(hostId, sessionId, async (repos) => repos.invitations.list(sessionId), false);
  }

  async optionsForBooker(hostId: UUID, sessionId: UUID): Promise<{
    readonly groups: readonly SessionInvitationGroup[];
    readonly invitations: readonly SessionInvite[];
  }> {
    return this.withHost(hostId, sessionId, async (repos) => ({
      groups: await repos.recipients.listGroups(hostId),
      invitations: await repos.invitations.list(sessionId),
    }), false);
  }

  private async issue(
    repos: SessionInvitationRepositories, session: Session, hostId: UUID,
    players: readonly InvitablePlayer[], groupId?: UUID,
  ): Promise<SessionInviteSummary> {
    const inRoster = new Set(session.participantList.participations.map((participant) => participant.userId));
    const eligible = players.filter((player) => player.userId !== hostId && !inRoster.has(player.userId));
    const inserted = await repos.invitations.add(session.sessionId, hostId, eligible, groupId);
    const added = new Set(inserted);
    await repos.notifications.append(eligible.filter((player) => added.has(player.userId)).map((player) => ({
      kind: "SESSION_INVITATION" as const, recipientId: player.userId,
      sessionId: session.sessionId, subjectName: session.booking.venueName,
      startAt: session.booking.startAt, expiresAt: session.booking.startAt,
      invitationToken: session.roomToken,
      occurrenceKey: JSON.stringify(["SESSION_INVITATION", session.sessionId, player.userId]),
    })));
    return {
      invited: inserted.length,
      alreadyInvited: eligible.length - inserted.length,
      alreadyParticipating: players.length - eligible.length,
    };
  }
}
