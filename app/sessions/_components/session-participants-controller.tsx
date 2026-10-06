"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { previewParticipantRemoval, removeParticipant, type SessionParticipantsOutcome } from "../removal-actions";
import { SessionParticipantsView } from "./session-participants-view";

/** Keeps each host/session recovery state isolated while server refreshes update the participant list. */
export function SessionParticipantsController({ sessionId, userId, outcome }: {
  readonly sessionId: string;
  readonly userId: string;
  readonly outcome: SessionParticipantsOutcome;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  return <SessionParticipantsView key={`${userId}:${sessionId}`} sessionId={sessionId} outcome={outcome}
    refreshing={refreshing} removal={{ userId, preview: previewParticipantRemoval, remove: removeParticipant }}
    onRefresh={() => startTransition(() => router.refresh())} />;
}
