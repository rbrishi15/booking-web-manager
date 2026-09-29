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

/** Validated business input; the caller supplies the authenticated booker ID. */
export interface CreateSessionInput {
  bookerId: UUID;
  booking: {
    venueName: string;
    region: Region;
    sport: Sport;
    startAt: Date;
    endAt: Date;
    totalCostCents: number;
  };
  config: SessionConfig;
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
  async forBooker(input: CreateSessionInput): Promise<CreateSessionResult> {
    const { transaction, clock, ids, holdingAccountId } = this.dependencies;
    const { bookerId } = input;

    return transaction.runForBooker(bookerId, async (repositories) => {
      const user = await requireAggregate(repositories.users, bookerId, "User");
      const booking = new Booking({
        venueName: input.booking.venueName,
        region: input.booking.region,
        sport: input.booking.sport,
        startAt: input.booking.startAt,
        endAt: input.booking.endAt,
        totalCost: Money.fromCents(input.booking.totalCostCents),
      });
      const session = user.asBooker().createSession({
        sessionId: ids.next(),
        roomToken: ids.next(),
        holdingAccountId,
        booking,
        totalSlots: input.config.totalSlots,
        minimumHeadcount: input.config.minimumHeadcount,
        visibility: input.config.visibility,
        minimumReliability:
          input.config.minimumReliability === undefined
            ? undefined
            : ReliabilityScore.from(input.config.minimumReliability),
        invitedGroupId: input.config.invitedGroupId,
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
