import { createHash } from "node:crypto";
import type { SessionEditingVersioner } from "@/use-cases/sessions/session-editing-transaction";

/** Includes admission history so an editor cannot save across a new commitment. */
export const sessionEditingVersioner: SessionEditingVersioner = {
  of: (session) => createHash("sha256").update(JSON.stringify({
    sessionId: session.sessionId, venue: session.booking.venueName, region: session.booking.region, sport: session.booking.sport,
    startAt: session.booking.startAt.toISOString(), endAt: session.booking.endAt.toISOString(),
    cost: session.booking.totalCost.toCents(), price: session.bookingShare.toCents(), totalSlots: session.totalSlots,
    visibility: session.visibility, status: session.status,
    participants: session.participantList.participations.map((p) =>
      [p.participationId, p.status, p.replacementMode, p.replacementInviteeId, p.replacesParticipationId]),
  })).digest("hex"),
};
