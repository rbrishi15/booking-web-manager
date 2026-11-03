"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { findPlayer } from "@/app/users/find-player-action";
import { previewParticipantRemoval, removeParticipant, type SessionParticipantsOutcome } from "../removal-actions";
import { loadSessionInvitation } from "../invitation-transport";
import { sendDirectSessionInvitations, sendGroupSessionInvitations } from "../session-invitation-actions";
import type { SessionInvitationsTransport } from "./session-participants-invitations";
import type { SessionInvitationOptions } from "../session-invitation-contract";
import { SessionParticipantsView } from "./session-participants-view";

const invitationTransport: SessionInvitationsTransport = {
  findPlayer,
  loadSessionInvitation,
  sendDirectSessionInvitations,
  sendGroupSessionInvitations,
};

/** Keeps each host/session recovery state isolated while server refreshes update the participant list. */
export function SessionParticipantsController({ sessionId, userId, outcome, invitationOptions }: {
  readonly sessionId: string;
  readonly userId: string;
  readonly outcome: SessionParticipantsOutcome;
  readonly invitationOptions: SessionInvitationOptions | null;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return <SessionParticipantsView key={`${userId}:${sessionId}`} sessionId={sessionId} outcome={outcome}
    groups={invitationOptions?.status === "ready" ? invitationOptions.groups : []}
    invitations={invitationOptions?.status === "ready" ? invitationOptions.invitations : []}
    invitationError={invitationOptions?.status === "error" ? invitationOptions.message : undefined}
    invitationTransport={invitationTransport} refreshing={refreshing} removal={{ userId, preview: previewParticipantRemoval, remove: removeParticipant }}
    onRefresh={() => startTransition(() => router.refresh())} />;
}
