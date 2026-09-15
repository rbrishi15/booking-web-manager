import { copyDate, copyOptionalDate } from "../shared/date";
import { DomainError, requireDomain } from "../shared/errors";
import type {
  AttendanceStatus,
  ParticipationStatus,
  ReplacementMode,
  VerificationMethod,
} from "../shared/statuses";
import type { UUID } from "../shared/types";
import { FundHold, type FundHoldSnapshot } from "./fund-hold";

export interface ParticipationSnapshot {
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
  readonly hold?: FundHoldSnapshot;
  readonly queueSequence?: number;
}

export interface ReliabilityOutcome {
  readonly value: 0 | 1;
  readonly finalizedAt: Date;
}

/** Immutable child of Session. A Session is the only object that changes its lifecycle. */
export class Participation {
  readonly #snapshot: ParticipationSnapshot;

  private constructor(snapshot: ParticipationSnapshot) {
    const hold =
      snapshot.hold === undefined
        ? undefined
        : FundHold.reconstitute(snapshot.hold);
    this.#snapshot = Object.freeze({
      ...snapshot,
      waitlistedAt: copyOptionalDate(snapshot.waitlistedAt, "waitlistedAt"),
      committedAt: copyOptionalDate(snapshot.committedAt, "committedAt"),
      withdrawnAt: copyOptionalDate(snapshot.withdrawnAt, "withdrawnAt"),
      verifiedAt: copyOptionalDate(snapshot.verifiedAt, "verifiedAt"),
      hold: hold?.snapshot(),
    });
  }

  static createWaitlisted(details: {
    readonly participationId: UUID;
    readonly userId: UUID;
    readonly waitlistedAt: Date;
    readonly queueSequence: number;
    readonly replacementToken?: string;
  }): Participation {
    requireDomain(
      Number.isSafeInteger(details.queueSequence) && details.queueSequence > 0,
      "INVALID_INPUT",
      "Queue sequence must be positive",
    );
    if (details.replacementToken !== undefined)
      requireDomain(
        typeof details.replacementToken === "string" &&
          details.replacementToken.trim() !== "",
        "INVALID_INPUT",
        "A replacement token cannot be empty",
      );
    return Participation.reconstitute({
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
    requireDomain(
      details.hold instanceof FundHold,
      "INVALID_INPUT",
      "A commitment needs a FundHold",
    );
    requireDomain(
      details.hold.state === "HELD",
      "INVALID_INPUT",
      "A new commitment needs a held fund",
    );
    return Participation.reconstitute({
      participationId: details.participationId,
      userId: details.userId,
      status: "COMMITTED",
      attendance: "UNVERIFIED",
      committedAt: details.committedAt,
      replacesParticipationId: details.replacesParticipationId,
      hold: details.hold.snapshot(),
    });
  }

  static reconstitute(snapshot: ParticipationSnapshot): Participation {
    requireId(snapshot.participationId, "participationId");
    requireId(snapshot.userId, "userId");
    requireDomain(
      [
        "WAITLISTED",
        "COMMITTED",
        "LEFT_WAITLIST",
        "WITHDRAWN",
        "REMOVED",
        "CANCELLED",
      ].includes(snapshot.status),
      "INVALID_INPUT",
      "Unknown participation status",
    );
    requireDomain(
      ["UNVERIFIED", "ATTENDED", "ABSENT"].includes(snapshot.attendance),
      "INVALID_INPUT",
      "Unknown attendance status",
    );
    if (snapshot.replacementMode !== undefined)
      requireDomain(
        ["OPEN_SLOT", "INVITE_LINK"].includes(snapshot.replacementMode),
        "INVALID_INPUT",
        "Unknown replacement mode",
      );
    if (snapshot.verificationMethod !== undefined)
      requireDomain(
        ["BOOKER", "AUTOMATIC"].includes(snapshot.verificationMethod),
        "INVALID_INPUT",
        "Unknown verification method",
      );
    const waitlistedAt = copyOptionalDate(
      snapshot.waitlistedAt,
      "waitlistedAt",
    );
    const committedAt = copyOptionalDate(snapshot.committedAt, "committedAt");
    const withdrawnAt = copyOptionalDate(snapshot.withdrawnAt, "withdrawnAt");
    const verifiedAt = copyOptionalDate(snapshot.verifiedAt, "verifiedAt");
    const hold =
      snapshot.hold === undefined
        ? undefined
        : FundHold.reconstitute(snapshot.hold);

    if (
      snapshot.attendance !== "UNVERIFIED" &&
      (verifiedAt === undefined || snapshot.verificationMethod === undefined)
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "Verified attendance requires verifiedAt and verificationMethod",
      );
    }
    if (
      snapshot.attendance === "UNVERIFIED" &&
      (verifiedAt !== undefined || snapshot.verificationMethod !== undefined)
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "Unverified attendance cannot have verification metadata",
      );
    }
    if (
      snapshot.status !== "COMMITTED" &&
      snapshot.attendance !== "UNVERIFIED"
    ) {
      throw new DomainError(
        "INVALID_INPUT",
        "Only a committed participation may have an attendance outcome",
      );
    }
    if (snapshot.status === "WAITLISTED") {
      requireDomain(
        waitlistedAt !== undefined && snapshot.queueSequence !== undefined,
        "INVALID_INPUT",
        "A waitlisted participation needs queue metadata",
      );
      requireDomain(
        hold === undefined,
        "INVALID_INPUT",
        "A waitlisted participation cannot hold funds",
      );
    }
    if (snapshot.status === "COMMITTED") {
      requireDomain(
        committedAt !== undefined && hold !== undefined,
        "INVALID_INPUT",
        "A committed participation needs a commitment time and hold",
      );
      requireDomain(
        ["HELD", "RELEASED", "FORFEITED"].includes(hold.state),
        "INVALID_INPUT",
        "A committed participation needs an active or settled hold",
      );
    }
    if (snapshot.status === "WITHDRAWN") {
      requireDomain(
        snapshot.attendance === "UNVERIFIED",
        "INVALID_INPUT",
        "A withdrawn participation cannot have attendance",
      );
      requireDomain(
        withdrawnAt !== undefined && hold !== undefined,
        "INVALID_INPUT",
        "A withdrawn participation needs a withdrawal time and hold",
      );
      requireDomain(
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
      snapshot.status === "LEFT_WAITLIST" ||
      snapshot.status === "REMOVED" ||
      snapshot.status === "CANCELLED"
    ) {
      requireDomain(
        hold === undefined ||
          ["REFUNDED", "RELEASED", "FORFEITED"].includes(hold.state),
        "INVALID_INPUT",
        "A closed participation cannot retain an active hold",
      );
    }
    if (snapshot.status !== "WITHDRAWN")
      requireDomain(
        snapshot.replacementMode === undefined &&
          snapshot.replacementToken === undefined,
        "INVALID_INPUT",
        "Replacement details belong only to a withdrawn participation",
      );
    if (snapshot.replacementToken !== undefined)
      requireDomain(
        typeof snapshot.replacementToken === "string" &&
          snapshot.replacementToken.trim() !== "",
        "INVALID_INPUT",
        "A replacement token cannot be empty",
      );
    if (snapshot.replacementMode === "INVITE_LINK")
      requireDomain(
        snapshot.replacementToken !== undefined,
        "INVALID_INPUT",
        "An invitation replacement needs a token",
      );
    if (snapshot.replacementMode === "OPEN_SLOT")
      requireDomain(
        snapshot.replacementToken === undefined,
        "INVALID_INPUT",
        "An open-slot replacement cannot have an invitation token",
      );
    if (snapshot.replacesParticipationId !== undefined) {
      requireId(snapshot.replacesParticipationId, "replacesParticipationId");
      requireDomain(
        snapshot.replacesParticipationId !== snapshot.participationId,
        "INVALID_INPUT",
        "A participation cannot replace itself",
      );
    }
    if (snapshot.queueSequence !== undefined)
      requireDomain(
        Number.isSafeInteger(snapshot.queueSequence) &&
          snapshot.queueSequence > 0,
        "INVALID_INPUT",
        "Queue sequence must be positive",
      );
    return new Participation({
      ...snapshot,
      waitlistedAt,
      committedAt,
      withdrawnAt,
      verifiedAt,
      hold: hold?.snapshot(),
    });
  }

  snapshot(): ParticipationSnapshot {
    return {
      ...this.#snapshot,
      waitlistedAt: copyOptionalDate(this.waitlistedAt, "waitlistedAt"),
      committedAt: copyOptionalDate(this.committedAt, "committedAt"),
      withdrawnAt: copyOptionalDate(this.withdrawnAt, "withdrawnAt"),
      verifiedAt: copyOptionalDate(this.verifiedAt, "verifiedAt"),
      hold: this.hold?.snapshot(),
    };
  }

  commit(hold: FundHold, at: Date): Participation {
    requireDomain(
      this.status === "WAITLISTED",
      "INVALID_STATE",
      "Only a waitlisted user can be promoted",
    );
    requireDomain(
      hold instanceof FundHold,
      "INVALID_INPUT",
      "Promotion requires a FundHold",
    );
    requireDomain(
      hold.state === "HELD",
      "INVALID_INPUT",
      "Promotion requires a held fund",
    );
    requireDomain(
      hold.participationId === this.participationId,
      "INVALID_INPUT",
      "The hold belongs to another participation",
    );
    return Participation.reconstitute({
      ...this.snapshot(),
      status: "COMMITTED",
      committedAt: at,
      hold: hold.snapshot(),
    });
  }

  leaveWaitlist(): Participation {
    requireDomain(
      this.status === "WAITLISTED",
      "INVALID_STATE",
      "Only a waitlisted user can leave the waitlist",
    );
    return Participation.reconstitute({
      ...this.snapshot(),
      status: "LEFT_WAITLIST",
    });
  }

  withdraw(
    hold: FundHold,
    at: Date,
    replacementMode?: ReplacementMode,
    replacementToken?: string,
  ): Participation {
    requireDomain(
      this.status === "COMMITTED",
      "INVALID_STATE",
      "Only a committed participant can withdraw",
    );
    requireDomain(
      hold instanceof FundHold,
      "INVALID_INPUT",
      "Withdrawal requires a FundHold",
    );
    requireDomain(
      hold.participationId === this.participationId,
      "INVALID_INPUT",
      "The hold belongs to another participation",
    );
    requireDomain(
      ["REFUNDED", "AWAITING_REPLACEMENT"].includes(hold.state),
      "INVALID_STATE",
      "Withdrawal needs a refunded or awaiting-replacement hold",
    );
    if (replacementMode === "INVITE_LINK")
      requireDomain(
        typeof replacementToken === "string" && replacementToken.trim() !== "",
        "INVALID_INPUT",
        "An invitation replacement needs a token",
      );
    if (replacementMode !== "INVITE_LINK")
      requireDomain(
        replacementToken === undefined,
        "INVALID_INPUT",
        "An open-slot replacement cannot have an invitation token",
      );
    return Participation.reconstitute({
      ...this.snapshot(),
      status: "WITHDRAWN",
      withdrawnAt: at,
      replacementMode,
      replacementToken,
      hold: hold.snapshot(),
    });
  }

  remove(hold: FundHold): Participation {
    requireDomain(
      this.status === "COMMITTED",
      "INVALID_STATE",
      "Only a committed participant can be removed",
    );
    requireDomain(
      hold instanceof FundHold,
      "INVALID_INPUT",
      "Removal requires a FundHold",
    );
    requireDomain(
      hold.state === "REFUNDED",
      "INVALID_STATE",
      "Removal requires a refund",
    );
    requireDomain(
      hold.participationId === this.participationId,
      "INVALID_INPUT",
      "The hold belongs to another participation",
    );
    return Participation.reconstitute({
      ...this.snapshot(),
      status: "REMOVED",
      hold: hold.snapshot(),
    });
  }

  cancel(hold?: FundHold): Participation {
    requireDomain(
      ["WAITLISTED", "LEFT_WAITLIST", "COMMITTED", "WITHDRAWN"].includes(
        this.status,
      ),
      "INVALID_STATE",
      "This participation is already closed",
    );
    if (this.status === "COMMITTED")
      requireDomain(
        hold?.state === "REFUNDED",
        "INVALID_STATE",
        "Cancellation requires a refund",
      );
    if (this.status === "COMMITTED" || this.status === "WITHDRAWN")
      requireDomain(
        hold === undefined || hold.participationId === this.participationId,
        "INVALID_INPUT",
        "The hold belongs to another participation",
      );
    if (this.status === "WAITLISTED" || this.status === "LEFT_WAITLIST")
      requireDomain(
        hold === undefined,
        "INVALID_INPUT",
        "A waitlist participation cannot be cancelled with a hold",
      );
    if (this.status === "WITHDRAWN" && hold !== undefined)
      requireDomain(
        hold.state === "REFUNDED",
        "INVALID_STATE",
        "Cancellation requires a refund",
      );
    return Participation.reconstitute({
      ...this.snapshot(),
      status: "CANCELLED",
      replacementMode: undefined,
      replacementToken: undefined,
      hold: hold?.snapshot() ?? this.hold?.snapshot(),
    });
  }

  verify(
    attendance: "ATTENDED" | "ABSENT",
    method: "BOOKER" | "AUTOMATIC",
    at: Date,
  ): Participation {
    requireDomain(
      attendance === "ATTENDED" || attendance === "ABSENT",
      "INVALID_INPUT",
      "Unknown attendance status",
    );
    requireDomain(
      method === "BOOKER" || method === "AUTOMATIC",
      "INVALID_INPUT",
      "Unknown verification method",
    );
    requireDomain(
      this.status === "COMMITTED",
      "INVALID_STATE",
      "Only a committed participant can be verified",
    );
    requireDomain(
      this.attendance === "UNVERIFIED",
      "ATTENDANCE_CONFLICT",
      "Attendance has already been verified",
    );
    return Participation.reconstitute({
      ...this.snapshot(),
      attendance,
      verificationMethod: method,
      verifiedAt: at,
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
    return this.#snapshot.participationId;
  }
  get userId(): UUID {
    return this.#snapshot.userId;
  }
  get status(): ParticipationStatus {
    return this.#snapshot.status;
  }
  get attendance(): AttendanceStatus {
    return this.#snapshot.attendance;
  }
  get waitlistedAt(): Date | undefined {
    return copyOptionalDate(this.#snapshot.waitlistedAt, "waitlistedAt");
  }
  get committedAt(): Date | undefined {
    return copyOptionalDate(this.#snapshot.committedAt, "committedAt");
  }
  get withdrawnAt(): Date | undefined {
    return copyOptionalDate(this.#snapshot.withdrawnAt, "withdrawnAt");
  }
  get replacementMode(): ReplacementMode | undefined {
    return this.#snapshot.replacementMode;
  }
  get replacementToken(): string | undefined {
    return this.#snapshot.replacementToken;
  }
  get verifiedAt(): Date | undefined {
    return copyOptionalDate(this.#snapshot.verifiedAt, "verifiedAt");
  }
  get verificationMethod(): VerificationMethod | undefined {
    return this.#snapshot.verificationMethod;
  }
  get replacesParticipationId(): UUID | undefined {
    return this.#snapshot.replacesParticipationId;
  }
  get queueSequence(): number | undefined {
    return this.#snapshot.queueSequence;
  }
  get hold(): FundHold | undefined {
    return this.#snapshot.hold === undefined
      ? undefined
      : FundHold.reconstitute(this.#snapshot.hold);
  }
}

function requireId(value: string, name: string): void {
  requireDomain(
    typeof value === "string" && value.trim() !== "",
    "INVALID_INPUT",
    `${name} is required`,
  );
}
