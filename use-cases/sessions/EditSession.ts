import { createHash } from "node:crypto";
import { Booking, DomainError, Money, type Session, type UUID, type Visibility } from "@/domain";
import type { Clock } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import type { SessionEditingRepositories, SessionEditingTransaction } from "./session-editing-transaction";

export interface SessionEditRequest {
  readonly version: string;
  readonly booking: {
    readonly venueName: string;
    readonly region: string;
    readonly sport: string;
    readonly startAt: string;
    readonly endAt: string;
    readonly totalCostCents: number;
    readonly pricePerSlotCents: number;
  };
  readonly totalSlots: number;
  readonly visibility: Visibility;
}

export interface SessionEditingDetails extends SessionEditRequest {
  readonly sessionId: UUID;
  readonly canEdit: boolean;
  readonly bookingLocked: boolean;
  readonly minimumSlots: number;
}

/** Owner-only editing; all policies are rechecked against locked current state on save. */
export class EditSession {
  constructor(private readonly dependencies: { readonly transaction: SessionEditingTransaction; readonly clock: Clock }) {}

  async detailsForBooker(bookerId: UUID, sessionId: UUID): Promise<SessionEditingDetails> {
    return this.dependencies.transaction.run(async (repositories) => {
      const { session } = await this.load(repositories, bookerId, sessionId);
      return details(session, this.dependencies.clock.now());
    });
  }

  async forBooker(bookerId: UUID, sessionId: UUID, input: SessionEditRequest): Promise<SessionEditingDetails> {
    return this.dependencies.transaction.run(async (repositories) => {
      const { user, session } = await this.load(repositories, bookerId, sessionId);
      const now = this.dependencies.clock.now();
      DomainError.require(input.version === details(session, now).version, "STALE_SESSION",
        "This session has changed. Reload the latest details before saving.");
      let booking: Booking;
      let bookingShare: Money;
      try {
        booking = new Booking({ ...input.booking, startAt: new Date(input.booking.startAt),
          endAt: new Date(input.booking.endAt), totalCost: Money.fromCents(input.booking.totalCostCents) });
        bookingShare = Money.fromCents(input.booking.pricePerSlotCents);
      } catch (error) {
        if (error instanceof RangeError) throw new DomainError("INVALID_INPUT", error.message);
        throw error;
      }
      const next = user.asBooker().editSession(session, { booking, bookingShare,
        totalSlots: input.totalSlots, visibility: input.visibility }, now);
      await repositories.sessions.saveDetails(next);
      return details(next, now);
    });
  }

  private async load(repositories: SessionEditingRepositories, bookerId: UUID, sessionId: UUID) {
    const user = await requireAggregate(repositories.users, bookerId, "User");
    DomainError.require(user.accountStatus === "ACTIVE", "INACTIVE_ACCOUNT", "An inactive account cannot manage sessions");
    const session = await requireAggregate(repositories.sessions, sessionId, "Session");
    DomainError.require(session.bookerId === user.userId, "UNAUTHORIZED", "Only the booker can edit this session");
    return { user, session };
  }
}

function details(session: Session, now: Date): SessionEditingDetails {
  const booking = { venueName: session.booking.venueName, region: session.booking.region, sport: session.booking.sport,
    startAt: session.booking.startAt.toISOString(), endAt: session.booking.endAt.toISOString(),
    totalCostCents: session.booking.totalCost.toCents(), pricePerSlotCents: session.bookingShare.toCents() };
  const version = createHash("sha256").update(JSON.stringify({ booking, totalSlots: session.totalSlots,
    visibility: session.visibility, status: session.status, participants: session.participantList.participations.map((p) =>
      [p.participationId, p.status, p.replacementMode, p.replacementInviteeId, p.replacesParticipationId]) })).digest("hex");
  const canEdit = session.status === "OPEN" && !session.booking.hasStarted(now);
  return { sessionId: session.sessionId, booking, totalSlots: session.totalSlots, visibility: session.visibility,
    version, canEdit, bookingLocked: session.bookingDetailsLocked,
    minimumSlots: canEdit ? session.totalSlots - session.getAvailableSlots(now) : session.totalSlots };
}
