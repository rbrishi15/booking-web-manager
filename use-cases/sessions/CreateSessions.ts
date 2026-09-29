import {
  Booking,
  Money,
  ReliabilityScore,
  type Region,
  type Sport,
  type UUID,
  type Visibility,
} from "@/domain";
import type { Clock, IdGenerator } from "../shared/contracts";
import { requireAggregate } from "../shared/helpers";
import type { SessionCreationTransaction } from "./session-creation-transaction";

/** The booker's choices for one session. */
export interface SessionConfig {
  totalSlots: number;
  minimumHeadcount: number;
  visibility?: Visibility;
  minimumReliability?: number;
  invitedGroupId?: UUID;
}

/** Validated details of the venue booking being shared. */
export interface SessionBooking {
  venueName: string;
  region: Region;
  sport: Sport;
  startAt: Date;
  endAt: Date;
  totalCostCents: number;
}

export interface CreateSessionResult {
  readonly sessionId: UUID;
  readonly roomToken: string;
  readonly bookingShareCents: number;
}

export interface CreateSessionsDependencies {
  readonly transaction: SessionCreationTransaction;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** The existing platform holding account, supplied by server configuration. */
  readonly holdingAccountId: UUID;
}

/** UC2-02: load the booker, apply domain creation rules, and save atomically. */
export class CreateSessions {
  constructor(private readonly dependencies: CreateSessionsDependencies) {}

  /**
   * Creates and persists the booker's session. The injected transaction is
   * scoped to one logical submission; domain rules are checked during creation.
   */
  async forBooker(
    bookerId: UUID,
    bookingDetails: SessionBooking,
    config: SessionConfig,
  ): Promise<CreateSessionResult> {
    const { transaction, clock, ids, holdingAccountId } = this.dependencies;

    return transaction.runForBooker(bookerId, async (repositories) => {
      const user = await requireAggregate(repositories.users, bookerId, "User");
      const booking = new Booking({
        venueName: bookingDetails.venueName,
        region: bookingDetails.region,
        sport: bookingDetails.sport,
        startAt: bookingDetails.startAt,
        endAt: bookingDetails.endAt,
        totalCost: Money.fromCents(bookingDetails.totalCostCents),
      });
      const session = user.asBooker().createSession({
        sessionId: ids.next(),
        roomToken: ids.next(),
        holdingAccountId,
        booking,
        totalSlots: config.totalSlots,
        minimumHeadcount: config.minimumHeadcount,
        visibility: config.visibility,
        minimumReliability:
          config.minimumReliability === undefined
            ? undefined
            : ReliabilityScore.from(config.minimumReliability),
        invitedGroupId: config.invitedGroupId,
        now: clock.now(),
      });

      await repositories.sessions.save(session);
      return {
        sessionId: session.sessionId,
        roomToken: session.roomToken,
        bookingShareCents: session.bookingShare.toCents(),
      };
    });
  }
}
