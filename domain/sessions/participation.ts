import { copyDate, copyOptionalDate } from "../shared/date";
import { DomainError } from "../shared/errors";
import type {
  AttendanceStatus,
  ParticipationStatus,
  ReplacementMode,
  VerificationMethod,
} from "../shared/statuses";
import type { UUID } from "../shared/types";
import { FundHold } from "./fund-hold";

export interface ParticipationDetails {
  readonly participationId: UUID;
  readonly userId: UUID;
  readonly status: ParticipationStatus;
  readonly attendance: AttendanceStatus;
  readonly waitlistedAt?: Date;
  readonly committedAt?: Date;
  readonly withdrawnAt?: Date;
  readonly replacementMode?: ReplacementMode;
  readonly replacementToken?: string;
  readonly verifiedAt?: Date;
  readonly verificationMethod?: VerificationMethod;
  readonly replacesParticipationId?: UUID;
  readonly hold?: FundHold;
  readonly queueSequence?: number;
}

export interface ReliabilityOutcome {
  readonly value: 0 | 1;
  readonly finalizedAt: Date;
}

/**
 * Immutable child entity of the Session aggregate root; owns an optional FundHold.
 * Transition methods validate this child's state and return a replacement.
 * Session commands decide when to apply that replacement to the roster and
 * enforce rules involving other participants, capacity, or settlement.
 */
export class Participation {
  readonly #participationId: UUID;
  readonly #userId: UUID;
  readonly #status: ParticipationStatus;
  readonly #attendance: AttendanceStatus;
  readonly #waitlistedAt?: Date;
  readonly #committedAt?: Date;
  readonly #withdrawnAt?: Date;
  readonly #replacementMode?: ReplacementMode;
  readonly #replacementToken?: string;
  readonly #verifiedAt?: Date;
  readonly #verificationMethod?: VerificationMethod;
  readonly #replacesParticipationId?: UUID;
  readonly #hold?: FundHold;
  readonly #queueSequence?: number;

  constructor(details: ParticipationDetails) {
    requireId(details.participationId, "participationId");
    requireId(details.userId, "userId");
    DomainError.require(
      [
        "WAITLISTED",
        "COMMITTED",
        "LEFT_WAITLIST",
        "WITHDRAWN",
        "REMOVED",
        "CANCELLED",
      ].includes(details.status),
      "INVALID_INPUT",
      "Unknown participation status",
    );
    DomainError.require(
      ["UNVERIFIED", "ATTENDED", "ABSENT"].includes(details.attendance),
      "INVALID_INPUT",
      "Unknown attendance status",
    );
    if (details.replacementMode !== undefined)
      DomainError.require(
        ["OPEN_SLOT", "INVITE_LINK"].includes(details.replacementMode),
        "INVALID_INPUT",
        "Unknown replacement mode",
      );
    if (details.verificationMethod !== undefined)
      DomainError.require(
        ["BOOKER", "AUTOMATIC"].includes(details.verificationMethod),
        "INVALID_INPUT",
        "Unknown verification method",
      );
    const waitlistedAt = copyOptionalDate(details.waitlistedAt, "waitlistedAt");
    const committedAt = copyOptionalDate(details.committedAt, "committedAt");
    const withdrawnAt = copyOptionalDate(details.withdrawnAt, "withdrawnAt");
    const verifiedAt = copyOptionalDate(details.verifiedAt, "verifiedAt");
    const hold = details.hold;
    DomainError.require(
      hold === undefined || hold.participationId === details.participationId,
      "INVALID_INPUT",
      "The hold belongs to another participation",
    );

    if (
      details.attendance !== "UNVERIFIED" &&
      (verifiedAt === undefined || details.verificationMethod === undefined)
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "Verified attendance requires verifiedAt and verificationMethod",
      );
    }
    if (
      details.attendance === "UNVERIFIED" &&
      (verifiedAt !== undefined || details.verificationMethod !== undefined)
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "Unverified attendance cannot have verification metadata",
      );
    }
    if (details.status !== "COMMITTED" && details.attendance !== "UNVERIFIED") {
      throw new DomainError(
        "INVALID_INPUT",
        "Only a committed participation may have an attendance outcome",
      );
    }
    if (details.status === "WAITLISTED") {
      DomainError.require(
        waitlistedAt !== undefined && details.queueSequence !== undefined,
        "INVALID_INPUT",
        "A waitlisted participation needs queue metadata",
      );
      DomainError.require(
        hold === undefined,
        "INVALID_INPUT",
        "A waitlisted participation cannot hold funds",
      );
    }
    if (details.status === "COMMITTED") {
      DomainError.require(
        committedAt !== undefined && hold !== undefined,
        "INVALID_INPUT",
        "A committed participation needs a commitment time and hold",
      );
      DomainError.require(
        ["HELD", "RELEASED", "FORFEITED"].includes(hold.state),
        "INVALID_INPUT",
        "A committed participation needs an active or settled hold",
      );
    }
    if (details.status === "WITHDRAWN") {
      DomainError.require(
        details.attendance === "UNVERIFIED",
        "INVALID_INPUT",
        "A withdrawn participation cannot have attendance",
      );
      DomainError.require(
        withdrawnAt !== undefined && hold !== undefined,
        "INVALID_INPUT",
        "A withdrawn participation needs a withdrawal time and hold",
      );
      DomainError.require(
        [
          "REFUNDED",
          "AWAITING_REPLACEMENT",
          "FORFEITURE_DUE",
          "FORFEITED",
        ].includes(hold.state),
        "INVALID_INPUT",
        "A withdrawn participation has an invalid hold state",
      );
    }
    if (
      details.status === "LEFT_WAITLIST" ||
      details.status === "REMOVED" ||
      details.status === "CANCELLED"
    ) {
      DomainError.require(
        hold === undefined ||
          ["REFUNDED", "RELEASED", "FORFEITED"].includes(hold.state),
        "INVALID_INPUT",
        "A closed participation cannot retain an active hold",
      );
    }
    if (details.status !== "WITHDRAWN")
      DomainError.require(
        details.replacementMode === undefined &&
          details.replacementToken === undefined,
        "INVALID_INPUT",
        "Replacement details belong only to a withdrawn participation",
      );
    if (details.replacementToken !== undefined)
      DomainError.require(
        details.replacementToken.trim() !== "",
        "INVALID_INPUT",
        "A replacement token cannot be empty",
      );
    if (details.replacementMode === "INVITE_LINK")
      DomainError.require(
        details.replacementToken !== undefined,
        "INVALID_INPUT",
        "An invitation replacement needs a token",
      );
    if (details.replacementMode === "OPEN_SLOT")
      DomainError.require(
        details.replacementToken === undefined,
        "INVALID_INPUT",
        "An open-slot replacement cannot have an invitation token",
      );
    if (details.replacesParticipationId !== undefined) {
      requireId(details.replacesParticipationId, "replacesParticipationId");
      DomainError.require(
        details.replacesParticipationId !== details.participationId,
        "INVALID_INPUT",
        "A participation cannot replace itself",
      );
    }
    if (details.queueSequence !== undefined)
      DomainError.require(
        Number.isSafeInteger(details.queueSequence) &&
          details.queueSequence > 0,
        "INVALID_INPUT",
        "Queue sequence must be positive",
      );

    this.#participationId = details.participationId;
    this.#userId = details.userId;
    this.#status = details.status;
    this.#attendance = details.attendance;
    this.#waitlistedAt = waitlistedAt;
    this.#committedAt = committedAt;
    this.#withdrawnAt = withdrawnAt;
    this.#replacementMode = details.replacementMode;
    this.#replacementToken = details.replacementToken;
    this.#verifiedAt = verifiedAt;
    this.#verificationMethod = details.verificationMethod;
    this.#replacesParticipationId = details.replacesParticipationId;
    this.#hold = details.hold;
    this.#queueSequence = details.queueSequence;
  }

  static createWaitlisted(details: {
    readonly participationId: UUID;
    readonly userId: UUID;
    readonly waitlistedAt: Date;
    readonly queueSequence: number;
    readonly replacementToken?: string;
  }): Participation {
    DomainError.require(
      Number.isSafeInteger(details.queueSequence) && details.queueSequence > 0,
      "INVALID_INPUT",
      "Queue sequence must be positive",
    );
    if (details.replacementToken !== undefined)
      DomainError.require(
        details.replacementToken.trim() !== "",
        "INVALID_INPUT",
        "A replacement token cannot be empty",
      );
    return new Participation({
      ...details,
      status: "WAITLISTED",
      attendance: "UNVERIFIED",
    });
  }

  static createCommitted(details: {
    readonly participationId: UUID;
    readonly userId: UUID;
    readonly committedAt: Date;
    readonly hold: FundHold;
    readonly replacesParticipationId?: UUID;
    readonly replacementMode?: ReplacementMode;
  }): Participation {
    DomainError.require(
      details.hold.state === "HELD",
      "INVALID_INPUT",
      "A new commitment needs a held fund",
    );
    return new Participation({
      participationId: details.participationId,
      userId: details.userId,
      status: "COMMITTED",
      attendance: "UNVERIFIED",
      committedAt: details.committedAt,
      replacesParticipationId: details.replacesParticipationId,
      hold: details.hold,
    });
  }

  commit(
    hold: FundHold,
    at: Date,
    replacesParticipationId?: UUID,
  ): Participation {
    DomainError.require(
      this.status === "WAITLISTED",
      "INVALID_STATE",
      "Only a waitlisted user can be promoted",
    );
    DomainError.require(
      hold.state === "HELD",
      "INVALID_INPUT",
      "Promotion requires a held fund",
    );
    DomainError.require(
      hold.participationId === this.participationId,
      "INVALID_INPUT",
      "The hold belongs to another participation",
    );
    return this.withChanges({
      status: "COMMITTED",
      committedAt: at,
      hold: hold,
      replacesParticipationId,
    });
  }

  leaveWaitlist(): Participation {
    DomainError.require(
      this.status === "WAITLISTED",
      "INVALID_STATE",
      "Only a waitlisted user can leave the waitlist",
    );
    return this.withChanges({
      status: "LEFT_WAITLIST",
    });
  }

  withdraw(
    hold: FundHold,
    at: Date,
    replacementMode?: ReplacementMode,
    replacementToken?: string,
  ): Participation {
    DomainError.require(
      this.status === "COMMITTED",
      "INVALID_STATE",
      "Only a committed participant can withdraw",
    );
    DomainError.require(
      hold.participationId === this.participationId,
      "INVALID_INPUT",
      "The hold belongs to another participation",
    );
    DomainError.require(
      ["REFUNDED", "AWAITING_REPLACEMENT"].includes(hold.state),
      "INVALID_STATE",
      "Withdrawal needs a refunded or awaiting-replacement hold",
    );
    if (replacementMode === "INVITE_LINK")
      DomainError.require(
        replacementToken !== undefined && replacementToken.trim() !== "",
        "INVALID_INPUT",
        "An invitation replacement needs a token",
      );
    if (replacementMode !== "INVITE_LINK")
      DomainError.require(
        replacementToken === undefined,
        "INVALID_INPUT",
        "An open-slot replacement cannot have an invitation token",
      );
    return this.withChanges({
      status: "WITHDRAWN",
      withdrawnAt: at,
      replacementMode,
      replacementToken,
      hold: hold,
    });
  }

  remove(hold: FundHold): Participation {
    DomainError.require(
      this.status === "COMMITTED",
      "INVALID_STATE",
      "Only a committed participant can be removed",
    );
    DomainError.require(
      hold.state === "REFUNDED",
      "INVALID_STATE",
      "Removal requires a refund",
    );
    DomainError.require(
      hold.participationId === this.participationId,
      "INVALID_INPUT",
      "The hold belongs to another participation",
    );
    return this.withChanges({
      status: "REMOVED",
      hold: hold,
    });
  }

  cancel(hold?: FundHold): Participation {
    DomainError.require(
      ["WAITLISTED", "LEFT_WAITLIST", "COMMITTED", "WITHDRAWN"].includes(
        this.status,
      ),
      "INVALID_STATE",
      "This participation is already closed",
    );
    if (this.status === "COMMITTED")
      DomainError.require(
        hold?.state === "REFUNDED",
        "INVALID_STATE",
        "Cancellation requires a refund",
      );
    if (this.status === "COMMITTED" || this.status === "WITHDRAWN")
      DomainError.require(
        hold === undefined || hold.participationId === this.participationId,
        "INVALID_INPUT",
        "The hold belongs to another participation",
      );
    if (this.status === "WAITLISTED" || this.status === "LEFT_WAITLIST")
      DomainError.require(
        hold === undefined,
        "INVALID_INPUT",
        "A waitlist participation cannot be cancelled with a hold",
      );
    if (this.status === "WITHDRAWN" && hold !== undefined)
      DomainError.require(
        hold.state === "REFUNDED",
        "INVALID_STATE",
        "Cancellation requires a refund",
      );
    return this.withChanges({
      status: "CANCELLED",
      replacementMode: undefined,
      replacementToken: undefined,
      hold: hold ?? this.hold,
    });
  }

  verify(
    attendance: "ATTENDED" | "ABSENT",
    method: "BOOKER" | "AUTOMATIC",
    at: Date,
  ): Participation {
    DomainError.require(
      attendance === "ATTENDED" || attendance === "ABSENT",
      "INVALID_INPUT",
      "Unknown attendance status",
    );
    DomainError.require(
      method === "BOOKER" || method === "AUTOMATIC",
      "INVALID_INPUT",
      "Unknown verification method",
    );
    DomainError.require(
      this.status === "COMMITTED",
      "INVALID_STATE",
      "Only a committed participant can be verified",
    );
    DomainError.require(
      this.attendance === "UNVERIFIED",
      "ATTENDANCE_CONFLICT",
      "Attendance has already been verified",
    );
    return this.withChanges({
      attendance,
      verificationMethod: method,
      verifiedAt: at,
    });
  }

  refundReplacement(at: Date): Participation {
    DomainError.require(
      this.#status === "WITHDRAWN" &&
        this.#hold?.state === "AWAITING_REPLACEMENT",
      "INVALID_STATE",
      "Only an awaiting replacement can be refunded",
    );
    return this.withChanges({ hold: this.#hold.refund(at) });
  }

  expireReplacement(at: Date): Participation {
    copyDate(at, "at");
    if (
      this.#status !== "WITHDRAWN" ||
      this.#hold?.state !== "AWAITING_REPLACEMENT"
    )
      return this;
    return this.withChanges({ hold: this.#hold.markForfeitureDue(at) });
  }

  settleHold(
    kind: "RELEASE" | "FORFEIT",
    payoutId: UUID,
    at: Date,
  ): Participation {
    const hold = this.#hold;
    const isPayableParticipation =
      hold !== undefined &&
      (this.#status === "COMMITTED" || this.#status === "WITHDRAWN");
    DomainError.require(
      isPayableParticipation,
      "INVALID_STATE",
      "Settlement requires a payable participation",
    );
    const settlementMatchesOutcome =
      kind === "RELEASE"
        ? this.#status === "COMMITTED" && this.#attendance === "ATTENDED"
        : kind === "FORFEIT" &&
          (this.#status === "WITHDRAWN" ||
            this.#attendance === "ABSENT" ||
            hold.state === "FORFEITURE_DUE");
    DomainError.require(
      settlementMatchesOutcome,
      "INVALID_STATE",
      "Settlement reason must match the participation outcome",
    );
    return this.withChanges({
      hold:
        kind === "RELEASE"
          ? hold.release(payoutId, at)
          : hold.forfeit(payoutId, at),
    });
  }

  reliabilityOutcome(asOf: Date): ReliabilityOutcome | undefined {
    const cutoff = copyDate(asOf, "asOf").getTime();
    if (
      this.status === "COMMITTED" &&
      this.attendance !== "UNVERIFIED" &&
      this.verifiedAt !== undefined
    ) {
      if (this.verifiedAt.getTime() <= cutoff)
        return {
          value: this.attendance === "ATTENDED" ? 1 : 0,
          finalizedAt: this.verifiedAt,
        };
    }
    if (
      this.status === "WITHDRAWN" &&
      this.hold?.state === "FORFEITED" &&
      this.hold.settledAt !== undefined
    ) {
      if (this.hold.settledAt.getTime() <= cutoff)
        return { value: 0, finalizedAt: this.hold.settledAt };
    }
    return undefined;
  }

  get participationId(): UUID {
    return this.#participationId;
  }
  get userId(): UUID {
    return this.#userId;
  }
  get status(): ParticipationStatus {
    return this.#status;
  }
  get attendance(): AttendanceStatus {
    return this.#attendance;
  }
  get waitlistedAt(): Date | undefined {
    return copyOptionalDate(this.#waitlistedAt, "waitlistedAt");
  }
  get committedAt(): Date | undefined {
    return copyOptionalDate(this.#committedAt, "committedAt");
  }
  get withdrawnAt(): Date | undefined {
    return copyOptionalDate(this.#withdrawnAt, "withdrawnAt");
  }
  get replacementMode(): ReplacementMode | undefined {
    return this.#replacementMode;
  }
  get replacementToken(): string | undefined {
    return this.#replacementToken;
  }
  get verifiedAt(): Date | undefined {
    return copyOptionalDate(this.#verifiedAt, "verifiedAt");
  }
  get verificationMethod(): VerificationMethod | undefined {
    return this.#verificationMethod;
  }
  get replacesParticipationId(): UUID | undefined {
    return this.#replacesParticipationId;
  }
  get queueSequence(): number | undefined {
    return this.#queueSequence;
  }
  get hold(): FundHold | undefined {
    return this.#hold;
  }
  private withChanges(
    changes: Partial<Omit<ParticipationDetails, "participationId" | "userId">>,
  ): Participation {
    return new Participation({
      participationId: this.#participationId,
      userId: this.#userId,
      status: this.#status,
      attendance: this.#attendance,
      waitlistedAt: this.#waitlistedAt,
      committedAt: this.#committedAt,
      withdrawnAt: this.#withdrawnAt,
      replacementMode: this.#replacementMode,
      replacementToken: this.#replacementToken,
      verifiedAt: this.#verifiedAt,
      verificationMethod: this.#verificationMethod,
      replacesParticipationId: this.#replacesParticipationId,
      hold: this.#hold,
      queueSequence: this.#queueSequence,
      ...changes,
    });
  }
}

function requireId(value: string, name: string): void {
  DomainError.require(
    value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
