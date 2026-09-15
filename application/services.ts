import { User } from "../domain/accounts/user";
import { Payout } from "../domain/finance/payout";
import {
  RegularGroup,
  type RegularGroupCreateProps,
} from "../domain/groups/regular-group";
import { Session, type SessionCreateProps } from "../domain/sessions/session";
import { DomainError } from "../domain/shared/errors";
import type {
  AdmissionResult,
  FinancialInstruction,
  FinancialResult,
  PayoutRequestedIntent,
  PromotionResult,
  WithdrawalResult,
} from "../domain/shared/operations";
import type { UUID } from "../domain/shared/types";
import type {
  Clock,
  DomainTransaction,
  IdGenerator,
  UnitOfWork,
} from "./contracts";

export interface ApplicationServiceDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Coordinates aggregate commands and commits their financial side effects atomically. */
export class SessionApplicationService {
  constructor(private readonly dependencies: ApplicationServiceDependencies) {}

  create(
    command: Omit<
      SessionCreateProps,
      "bookerStatus" | "payoutReady" | "now"
    > & { readonly idempotencyKey: string },
  ): Promise<Session> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const booker = await requireAggregate(
          transaction.users,
          command.bookerId,
          "User",
        );
        const destination = booker.payoutDestination();
        const session = Session.create({
          ...command,
          bookerStatus: booker.accountStatus,
          payoutReady: destination !== undefined,
          now: this.now(),
        });
        await transaction.sessions.save(session);
        return session;
      },
    );
  }

  join(command: {
    readonly sessionId: UUID;
    readonly userId: UUID;
    readonly idempotencyKey: string;
    readonly roomToken?: string;
    readonly replacementToken?: string;
    readonly replacementMode?: "OPEN_SLOT" | "INVITE_LINK";
  }): Promise<AdmissionResult> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        const facts = await transaction.admissionFacts.get(
          command.sessionId,
          command.userId,
        );
        const existingParticipationId = session.participations.find(
          (participation) => participation.userId === command.userId,
        )?.participationId;
        const result = session.join({
          participationId:
            existingParticipationId ?? this.dependencies.ids.next(),
          holdId: this.dependencies.ids.next(),
          facts,
          now: this.now(),
          roomToken: command.roomToken,
          replacementToken: command.replacementToken,
          replacementMode: command.replacementMode,
        });
        await appendInstructions(transaction, result.instructions);
        await transaction.sessions.save(session);
        return result;
      },
    );
  }

  promoteNext(command: {
    readonly sessionId: UUID;
    readonly userId: UUID;
    readonly idempotencyKey: string;
  }): Promise<PromotionResult> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        const facts = await transaction.admissionFacts.get(
          command.sessionId,
          command.userId,
        );
        const result = session.promoteNext({
          holdId: this.dependencies.ids.next(),
          facts,
          now: this.now(),
        });
        await appendInstructions(transaction, result.instructions);
        await transaction.sessions.save(session);
        return result;
      },
    );
  }

  leaveWaitlist(command: {
    readonly sessionId: UUID;
    readonly userId: UUID;
    readonly participationId: UUID;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        session.leaveWaitlist({
          actorId: command.userId,
          participationId: command.participationId,
          now: this.now(),
        });
        await transaction.sessions.save(session);
      },
    );
  }

  withdraw(command: {
    readonly sessionId: UUID;
    readonly userId: UUID;
    readonly participationId: UUID;
    readonly idempotencyKey: string;
    readonly replacementMode?: "OPEN_SLOT" | "INVITE_LINK";
    readonly replacementToken?: string;
  }): Promise<WithdrawalResult> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        const result = session.withdrawParticipant({
          actorId: command.userId,
          participationId: command.participationId,
          now: this.now(),
          replacementMode: command.replacementMode,
          replacementToken: command.replacementToken,
        });
        await appendInstructions(transaction, result.instructions);
        await transaction.sessions.save(session);
        return result;
      },
    );
  }

  remove(command: {
    readonly sessionId: UUID;
    readonly bookerId: UUID;
    readonly participationId: UUID;
    readonly idempotencyKey: string;
  }): Promise<FinancialResult> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        const result = session.removeParticipant({
          actorId: command.bookerId,
          participationId: command.participationId,
          now: this.now(),
        });
        await appendInstructions(transaction, result.instructions);
        await transaction.sessions.save(session);
        return result;
      },
    );
  }

  cancel(command: {
    readonly sessionId: UUID;
    readonly bookerId: UUID;
    readonly idempotencyKey: string;
  }): Promise<FinancialResult> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        const result = session.cancel({
          actorId: command.bookerId,
          now: this.now(),
        });
        await appendInstructions(transaction, result.instructions);
        await transaction.sessions.save(session);
        return result;
      },
    );
  }

  changeVisibility(command: {
    readonly sessionId: UUID;
    readonly bookerId: UUID;
    readonly visibility: "PRIVATE" | "PUBLIC";
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        session.changeVisibility({
          actorId: command.bookerId,
          visibility: command.visibility,
          now: this.now(),
        });
        await transaction.sessions.save(session);
      },
    );
  }

  verifyAttendance(command: {
    readonly sessionId: UUID;
    readonly bookerId: UUID;
    readonly marks: readonly {
      readonly participationId: UUID;
      readonly attendance: "ATTENDED" | "ABSENT";
    }[];
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        session.verifyAttendance({
          actorId: command.bookerId,
          marks: command.marks,
          now: this.now(),
        });
        await transaction.sessions.save(session);
      },
    );
  }

  autoVerifyAttendance(command: {
    readonly sessionId: UUID;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        session.autoVerifyAttendance(this.now());
        await transaction.sessions.save(session);
      },
    );
  }

  requestSettlement(command: {
    readonly sessionId: UUID;
    readonly bookerId: UUID;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly payout?: Payout;
    readonly intent?: PayoutRequestedIntent;
  }> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const session = await requireAggregate(
          transaction.sessions,
          command.sessionId,
          "Session",
        );
        const booker = await requireAggregate(
          transaction.users,
          command.bookerId,
          "User",
        );
        const batch = session.prepareSettlement({
          actorId: command.bookerId,
          payoutId: this.dependencies.ids.next(),
          idempotencyKey: command.idempotencyKey,
          destination: booker.payoutDestination(),
          now: this.now(),
        });
        if (batch === undefined) {
          await transaction.sessions.save(session);
          return {};
        }
        const payout = Payout.create(batch);
        await transaction.sessions.save(session);
        await transaction.payouts.save(payout);
        const intent = payout.requestedIntent();
        await transaction.payoutIntents.append(intent);
        return { payout, intent };
      },
    );
  }

  completePayout(command: {
    readonly payoutId: UUID;
    readonly providerReference: string;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly applied: boolean;
    readonly result?: FinancialResult;
  }> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const payout = await requireAggregate(
          transaction.payouts,
          command.payoutId,
          "Payout",
        );
        if (
          payout.status === "COMPLETED" &&
          payout.providerReference === command.providerReference
        )
          return { applied: false };
        const changed = payout.complete(command.providerReference, this.now());
        if (!changed) return { applied: false };
        const session = await requireAggregate(
          transaction.sessions,
          payout.sessionId,
          "Session",
        );
        const result = session.completeSettlement(payout.payoutId, this.now());
        await appendInstructions(transaction, result.instructions);
        await transaction.payouts.save(payout);
        await transaction.sessions.save(session);
        return { applied: true, result };
      },
    );
  }

  failPayout(command: {
    readonly payoutId: UUID;
    readonly reason: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly applied: boolean }> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const payout = await requireAggregate(
          transaction.payouts,
          command.payoutId,
          "Payout",
        );
        if (
          payout.status === "FAILED" &&
          payout.failureReason === command.reason
        )
          return { applied: false };
        const changed = payout.fail(command.reason, this.now());
        if (!changed) return { applied: false };
        const session = await requireAggregate(
          transaction.sessions,
          payout.sessionId,
          "Session",
        );
        session.failSettlement(payout.payoutId, this.now());
        await transaction.payouts.save(payout);
        await transaction.sessions.save(session);
        return { applied: true };
      },
    );
  }

  private now(): Date {
    return new Date(this.dependencies.clock.now().getTime());
  }
}

/** Named facade for callers that route only payout/settlement commands. */
export class PayoutApplicationService extends SessionApplicationService {
  request = this.requestSettlement.bind(this);
  complete = this.completePayout.bind(this);
  fail = this.failPayout.bind(this);
}

export class SettlementApplicationService extends SessionApplicationService {}

/** Coordinates profile, payout setup, and account anonymisation commands. */
export class UserApplicationService {
  constructor(private readonly dependencies: ApplicationServiceDependencies) {}
  updateProfile(command: {
    readonly userId: UUID;
    readonly email: string;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const user = await requireAggregate(
          transaction.users,
          command.userId,
          "User",
        );
        user.updateProfile({ email: command.email });
        await transaction.users.save(user);
      },
    );
  }
  updatePreferences(command: {
    readonly userId: UUID;
    readonly preferredSports: ReadonlySet<string>;
    readonly preferredRegions: ReadonlySet<string>;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const user = await requireAggregate(
          transaction.users,
          command.userId,
          "User",
        );
        user.updatePreferences(command);
        await transaction.users.save(user);
      },
    );
  }
  beginPayoutSetup(command: {
    readonly userId: UUID;
    readonly payoutAccountId: UUID;
    readonly providerAccountReference: string;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const user = await requireAggregate(
          transaction.users,
          command.userId,
          "User",
        );
        user.beginPayoutSetup(command);
        await transaction.users.save(user);
      },
    );
  }
  completePayoutSetup(command: {
    readonly userId: UUID;
    readonly bankAccountReference: string;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const user = await requireAggregate(
          transaction.users,
          command.userId,
          "User",
        );
        user.completePayoutSetup(command.bankAccountReference);
        await transaction.users.save(user);
      },
    );
  }
  deactivate(command: {
    readonly userId: UUID;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const user = await requireAggregate(
          transaction.users,
          command.userId,
          "User",
        );
        user.deactivate(
          await transaction.deactivationFacts.get(command.userId),
        );
        await transaction.users.save(user);
      },
    );
  }
}

/** Coordinates invitation and membership commands while keeping group policy in the aggregate. */
export class GroupApplicationService {
  constructor(private readonly dependencies: ApplicationServiceDependencies) {}
  create(
    command: Omit<RegularGroupCreateProps, "now"> & {
      readonly idempotencyKey: string;
    },
  ): Promise<RegularGroup> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const group = RegularGroup.create({
          ...command,
          now: new Date(this.dependencies.clock.now().getTime()),
        });
        await transaction.groups.save(group);
        return group;
      },
    );
  }
  join(command: {
    readonly groupId: UUID;
    readonly userId: UUID;
    readonly invitationToken: string;
    readonly idempotencyKey: string;
  }): Promise<"JOINED" | "ALREADY_MEMBER"> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const group = await requireAggregate(
          transaction.groups,
          command.groupId,
          "Group",
        );
        const result = group.join({
          userId: command.userId,
          invitationToken: command.invitationToken,
          now: new Date(this.dependencies.clock.now().getTime()),
        });
        await transaction.groups.save(group);
        return result;
      },
    );
  }
  removeMember(command: {
    readonly groupId: UUID;
    readonly ownerId: UUID;
    readonly userId: UUID;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const group = await requireAggregate(
          transaction.groups,
          command.groupId,
          "Group",
        );
        group.removeMember({
          actorId: command.ownerId,
          userId: command.userId,
        });
        await transaction.groups.save(group);
      },
    );
  }
  archive(command: {
    readonly groupId: UUID;
    readonly ownerId: UUID;
    readonly unsettledLinkedSessions: number;
    readonly idempotencyKey: string;
  }): Promise<void> {
    return this.dependencies.unitOfWork.execute(
      command.idempotencyKey,
      async (transaction) => {
        const group = await requireAggregate(
          transaction.groups,
          command.groupId,
          "Group",
        );
        group.archive({
          actorId: command.ownerId,
          unsettledLinkedSessions: command.unsettledLinkedSessions,
        });
        await transaction.groups.save(group);
      },
    );
  }
}

async function requireAggregate<T>(
  repository: { get(id: UUID): Promise<T | null> },
  id: UUID,
  name: string,
): Promise<T> {
  const aggregate = await repository.get(id);
  if (aggregate === null)
    throw new DomainError("NOT_FOUND", `${name} was not found`);
  return aggregate;
}

async function appendInstructions(
  transaction: Pick<DomainTransaction, "ledger">,
  instructions: readonly FinancialInstruction[],
): Promise<void> {
  if (instructions.length > 0) await transaction.ledger.append(instructions);
}
