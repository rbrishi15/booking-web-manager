import type { Session } from "@/domain";
import type { DomainTransaction, IdGenerator } from "../shared/contracts";
import { appendInstructions, requireAggregate } from "../shared/helpers";

/** Fill ordinary vacancies without accepting or bypassing a personal invitation. */
export async function promoteWaitlist(
  transaction: DomainTransaction,
  session: Session,
  ids: IdGenerator,
  now: Date,
): Promise<void> {
  while (session.getAvailableSlots(now) > 0) {
    const next = session.participantList.nextWaitlisted();
    if (
      next === undefined ||
      session.participantList.personalReplacementForInvitee(next.userId) !==
        undefined
    )
      return;

    const user = await requireAggregate(transaction.users, next.userId, "User");
    const result = user.asParticipant().promoteFromWaitlist(session, {
      holdId: ids.next(),
      now,
    });
    await appendInstructions(transaction, result.instructions);
    if (result.kind === "NONE") return;
  }
}
