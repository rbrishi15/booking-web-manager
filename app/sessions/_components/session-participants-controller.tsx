"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionParticipantsOutcome } from "../removal-actions";
import { loadSessionInvitation } from "../invitation-transport";
import { participantManagementApi, participantManagementFailure } from "../participant-management-transport";
import type { SessionInvitationsTransport } from "./session-participants-invitations";
import type { SendSessionInvitationsRequest } from "../session-invitation-contract";
import { SessionParticipantsView } from "./session-participants-view";

export const participantManagementQueryKey = (userId: string, sessionId: string) => ["sessions", "participants", userId, sessionId] as const;

/** Keeps each host/session recovery state isolated while server refreshes update the participant list. */
export function SessionParticipantsController({ sessionId, userId, outcome, api = participantManagementApi }: {
  readonly sessionId: string;
  readonly userId: string;
  readonly outcome: SessionParticipantsOutcome;
  /** Browser HTTP boundary; deterministic adapters are supplied in stories. */
  readonly api?: typeof participantManagementApi;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [refreshing, startTransition] = useTransition();
  const key = useMemo(() => participantManagementQueryKey(userId, sessionId), [userId, sessionId]);
  const roster = useQuery({ queryKey: [...key, "roster"], queryFn: ({ signal }) => api.loadParticipantRoster(sessionId, signal),
    initialData: outcome.status === "ready" ? outcome.session : undefined, retry: false });
  const options = useQuery({ queryKey: [...key, "invitations"], queryFn: ({ signal }) => api.loadParticipantInvitationOptions(sessionId, signal),
    enabled: roster.isSuccess, retry: false });
  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: key }), [queryClient, key]);
  const { mutateAsync: invite } = useMutation({
    mutationKey: [...key, "send"], mutationFn: (selection: SendSessionInvitationsRequest) => api.sendParticipantInvitations(sessionId, selection),
    retry: false, onSuccess: () => { void invalidate(); },
  });
  const { mutateAsync: remove } = useMutation({
    mutationKey: [...key, "remove"],
    mutationFn: (input: { participationId: string; submission: { idempotencyKey: string; previewVersion: string } }) => api.removeParticipantViaApi(sessionId, input.participationId, input.submission),
    retry: false,
  });
  const invitationTransport = useMemo<SessionInvitationsTransport>(() => {
    const send = async (selection: SendSessionInvitationsRequest) => {
      try { return { status: "sent" as const, ...await invite(selection) }; }
      catch (error) { return participantManagementFailure(error); }
    };
    return {
      findPlayer: async (_previous, form) => {
        const handle = String(form.get("handle") ?? "");
        try {
          return await queryClient.fetchQuery({ queryKey: [...key, "player", handle],
            queryFn: ({ signal }) => api.findParticipantPlayer(handle, userId, signal), staleTime: 0, retry: false });
        } catch (error) { return participantManagementFailure(error); }
      },
      loadSessionInvitation: (id) => queryClient.fetchQuery({ queryKey: [...key, "link"],
        queryFn: ({ signal }) => loadSessionInvitation(id, signal), staleTime: 0, retry: false }),
      sendDirectSessionInvitations: (_id, handles) => send({ source: "direct", handles: [...handles] }),
      sendGroupSessionInvitations: (_id, groupId, userIds) => send({ source: "group", groupId, userIds: [...userIds] }),
    };
  }, [api, invite, key, queryClient, userId]);
  const preview = useCallback(async (_id: string, participationId: string) => {
    try {
      const result = await queryClient.fetchQuery({ queryKey: [...key, "removal-preview", participationId],
        queryFn: ({ signal }) => api.loadParticipantRemovalPreview(sessionId, participationId, signal), staleTime: 0, retry: false });
      return { status: "ready" as const, preview: result };
    } catch (error) { return participantManagementFailure(error); }
  }, [api, key, queryClient, sessionId]);
  const removeWithRecovery = useCallback(async (_id: string, participationId: string, submission: { idempotencyKey: string; previewVersion: string }) => {
    try { return { status: "removed" as const, result: await remove({ participationId, submission }) }; }
    catch (error) { return participantManagementFailure(error); }
  }, [remove]);
  const currentOutcome: SessionParticipantsOutcome = roster.isError ? participantManagementFailure(roster.error)
    : roster.data ? { status: "ready", session: roster.data } : outcome;
  return <SessionParticipantsView key={`${userId}:${sessionId}`} sessionId={sessionId} outcome={currentOutcome}
    groups={roster.isSuccess ? options.data?.groups ?? [] : []}
    invitations={roster.isSuccess ? options.data?.invitations ?? [] : []}
    invitationError={options.isError ? participantManagementFailure(options.error).message : undefined}
    invitationsLoading={options.isPending}
    invitationTransport={invitationTransport} refreshing={refreshing || roster.isFetching}
    removal={{ userId, preview, remove: removeWithRecovery }}
    onSessionEdited={() => { void queryClient.invalidateQueries({ queryKey: ["sessions"] }); startTransition(() => router.refresh()); }}
    onRefresh={() => { void invalidate(); startTransition(() => router.refresh()); }} />;
}
