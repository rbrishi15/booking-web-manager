import type {
  JoinedSessionItem, LeaveWaitlist, PreviewWithdrawal, ReplacementCandidate, WithdrawFromSession, WithdrawalPreview,
} from "../withdrawal-ports";

/**
 * Fake UC2-05 transport and sample data for stories and tests, until the joined-sessions API
 * exists. Shapes follow GET /api/sessions/{sessionId}/withdrawal-preview,
 * POST /api/sessions/withdraw and POST /api/sessions/waitlist/leave.
 */
export const earlySession: JoinedSessionItem = {
  sessionId: "11111111-1111-4111-8111-111111111111", venueName: "Bishan Sports Hall", sport: "Badminton", region: "Central",
  startAt: "2045-04-12T10:00:00Z", endAt: "2045-04-12T12:00:00Z", status: "COMMITTED", bookingShareCents: 1250,
};
export const lateSession: JoinedSessionItem = {
  sessionId: "22222222-2222-4222-8222-222222222222", venueName: "Kallang Tennis Centre", sport: "Tennis", region: "Central",
  startAt: "2045-04-10T18:00:00Z", endAt: "2045-04-10T20:00:00Z", status: "COMMITTED", bookingShareCents: 800,
};
export const waitlistedSession: JoinedSessionItem = {
  sessionId: "33333333-3333-4333-8333-333333333333", venueName: "Jurong East Sports Hall", sport: "Basketball", region: "West",
  startAt: "2045-04-14T09:00:00Z", endAt: "2045-04-14T11:00:00Z", status: "WAITLISTED", bookingShareCents: 600,
};
export const joinedSessions: readonly JoinedSessionItem[] = [lateSession, earlySession, waitlistedSession];

export const candidates: readonly ReplacementCandidate[] = [
  { userId: "44444444-4444-4444-8444-444444444444", displayName: "Alex Tan" },
  { userId: "55555555-5555-4555-8555-555555555555", displayName: "Priya Lim" },
];

/** More than 30 hours before start the share comes back; otherwise it stays held awaiting a replacement. */
export function previewFor(session: JoinedSessionItem): WithdrawalPreview {
  return session.sessionId === lateSession.sessionId
    ? { kind: "AWAITING_REPLACEMENT", refundCents: 0, heldCents: session.bookingShareCents }
    : { kind: "REFUNDED", refundCents: session.bookingShareCents, heldCents: session.bookingShareCents };
}

export const fakePreviewWithdrawal: PreviewWithdrawal = async (sessionId) => {
  const session = joinedSessions.find((candidate) => candidate.sessionId === sessionId);
  return session === undefined
    ? { status: "error", message: "This session or your place in it no longer exists." }
    : { status: "ready", preview: previewFor(session) };
};

export const fakeWithdraw: WithdrawFromSession = async (request) => {
  const session = joinedSessions.find((candidate) => candidate.sessionId === request.sessionId);
  if (session === undefined) return { status: "error", code: "NOT_FOUND", message: "This session no longer exists.", unconfirmed: false };
  const preview = previewFor(session);
  return { status: "withdrawn", kind: preview.kind, refundedCents: preview.refundCents };
};

export const fakeLeaveWaitlist: LeaveWaitlist = async () => ({ status: "left" });
