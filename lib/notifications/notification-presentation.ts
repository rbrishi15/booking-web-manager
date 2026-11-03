import type { NotificationIntent } from "@/use-cases/notifications/notification-intents";

export interface NotificationPresentation {
  readonly category: "groups" | "bookings";
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly push: boolean;
}

/** Pure presentation: the canonical copy is saved once and reused by browser push. */
export function renderNotification(intent: NotificationIntent): NotificationPresentation {
  const session = encodeURIComponent(intent.sessionId ?? "");
  const group = encodeURIComponent(intent.groupId ?? "");
  const baseName = intent.subjectName || (intent.groupId ? "your group" : "your booking");
  const name = intent.startAt ? `${baseName} on ${new Intl.DateTimeFormat("en-SG", { timeZone:"Asia/Singapore",dateStyle:"medium",timeStyle:"short" }).format(intent.startAt)}` : baseName;
  const history = `/sessions?tab=joined&session=${session}`;
  const groups = `/groups/${group}`;
  const refund = intent.refundCents === undefined || intent.refundCents === 0 ? "" : ` S$${(intent.refundCents / 100).toFixed(2)} was returned to your wallet.`;
  const make = (title: string, body: string, url: string, push = false, category: "groups" | "bookings" = "bookings"): NotificationPresentation => ({ title, body, url, push, category });
  switch (intent.kind) {
    case "GROUP_INVITATION": return make("You've been invited to a group", `You have an invitation to ${name}. Open Groups to accept or decline.`, `/groups?invitation=${group}`, true, "groups");
    case "GROUP_INVITATION_ACCEPTED": return make("Group invitation accepted", `A player accepted your invitation to ${name}.`, groups, false, "groups");
    case "GROUP_INVITATION_DECLINED": return make("Group invitation declined", `A player declined your invitation to ${name}.`, groups, false, "groups");
    case "GROUP_MEMBER_JOINED": return make("A member joined your group", `A new member joined ${name}.`, groups, false, "groups");
    case "GROUP_MEMBER_LEFT": return make("A member left your group", `A member left ${name}.`, groups, false, "groups");
    case "GROUP_MEMBER_REMOVED": return make("Your group membership ended", `You were removed from ${name}. Your joined bookings are unaffected.`, "/groups", true, "groups");
    case "GROUP_RENAMED": return make("Group name updated", `Your group is now called ${name}.`, groups, false, "groups");
    case "GROUP_ARCHIVED": return make("Group archived", `${name} has been archived.`, groups, true, "groups");
    case "GROUP_INVITATION_ENDED": return make("Group invitation no longer available", `Your invitation to ${name} has ended.`, "/groups", false, "groups");
    case "SESSION_INVITATION": return make("You're invited to a session", `You were invited to join ${name}. Review the booking share and confirm your place.`, `/sessions/${session}/join?token=${encodeURIComponent(intent.invitationToken ?? "")}`, true);
    case "GROUP_BOOKING_CREATED": return make("A booking was shared with your group", `${name} is available to your group. Open the booking to view its details and join.`, `/sessions/${session}/join`, true);
    case "BOOKING_JOINED": return make("Your place is confirmed", `You joined ${name}; your booking share is held.`, history);
    case "WAITLIST_ENTERED": return make("You're on the waitlist", `You joined the waitlist for ${name}. No funds are held while you wait.`, history);
    case "PROMOTED": return make("You're in!", `A place opened in ${name} and your share is now held.`, history, true);
    case "REMOVED_FROM_WAITLIST": return intent.reason === "INSUFFICIENT_FUNDS"
      ? make("You missed a place", `Your wallet couldn't cover your share for ${name}, so you left the waitlist. Top up and join again if places remain.`, "/wallet", true)
      : make("You missed a place", `Your account no longer meets the requirements for ${name}, so you left the waitlist.`, "/discover", true);
    case "REPLACEMENT_INVITATION": return make("You've been invited to take a place", `You were named as a replacement for ${name}. Accept before the booking starts.`, `/sessions/joined?invitation=${session}`, true);
    case "REPLACEMENT_ACCEPTED": return make("Your replacement joined", `Your named replacement joined ${name}.${refund || " Any earlier refund is unchanged."}`, "/wallet", true);
    case "REPLACEMENT_REFUNDED": return make("Your held share was refunded", `A replacement joined ${name}.${refund}`, "/wallet", true);
    case "BOOKING_CANCELLED": return make("Booking cancelled", `${name} was cancelled.${refund}`, intent.refundCents ? "/wallet" : history, true);
    case "PARTICIPANT_REMOVED": return make("Your place was removed", `The booker removed your place in ${name}.${refund}`, intent.refundCents ? "/wallet" : history, true);
    case "FORFEITURE_WARNING": return make("Your share is still held", `You withdrew less than 30 hours before ${name}. Your share remains held and is forfeited unless someone replaces you before the start.`, "/wallet", true);
    case "FORFEITURE_DUE": return make("Your share is due for forfeiture", `${name} started without a replacement. Your share remains held for payment to the booker during settlement.`, "/wallet", true);
    case "VERIFICATION_REMINDER": return make("Verify attendance", `${name} has ended. Mark attendance; unverified participants are marked attended automatically 72 hours after the end.`, `/sessions/${session}/participants`, true);
  }
}

/** The JSON contract consumed by append_notifications and save_regular_group. */
export function encodeNotificationIntent(intent: NotificationIntent, occurrenceKey: string) {
  const rendered = renderNotification(intent);
  const subject = intent.sessionId ?? intent.groupId;
  if (!subject) throw new Error("Notification subject is required");
  return {
    recipient_id: intent.recipientId,
    source_key: JSON.stringify([intent.kind, subject, intent.occurrenceKey ?? occurrenceKey ?? subject]),
    category: rendered.category, title: rendered.title, body: rendered.body, destination: rendered.url,
    kind: intent.kind, session_id: intent.sessionId ?? null, group_id: intent.groupId ?? null,
    expires_at: intent.expiresAt?.toISOString() ?? null, push_enabled: rendered.push,
  };
}
