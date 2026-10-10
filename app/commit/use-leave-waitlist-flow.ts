"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { SessionActionError } from "./withdrawal-errors";
import type { JoinedSessionItem, LeaveWaitlist, LeaveWaitlistRequest } from "./withdrawal-ports";
import { joinedSessionsQueryKey } from "./withdrawal-query-keys";

/** Everything the leave-waitlist dialog shows. `closed` means no dialog. */
export type LeaveWaitlistState =
  | { readonly step: "closed" }
  | { readonly step: "confirming"; readonly session: JoinedSessionItem; readonly submitting: boolean; readonly error: string | null };

export interface LeaveWaitlistFlow {
  readonly state: LeaveWaitlistState;
  readonly start: (session: JoinedSessionItem) => void;
  readonly confirm: () => void;
  readonly close: () => void;
}

const UNCONFIRMED_MESSAGE = "We couldn't confirm whether you left the waitlist. Try again: the same request is reused.";

/**
 * UC2-05 leave the waitlist, for one dialog shared by every session. React Query runs the
 * departure (`useMutation`) and refreshes the joined sessions; this hook keeps the selected
 * session and, after an unconfirmed result, that session's idempotency key so a retry replays it.
 */
export function useLeaveWaitlistFlow({ leaveWaitlist }: { readonly leaveWaitlist: LeaveWaitlist }): LeaveWaitlistFlow {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<JoinedSessionItem | null>(null);
  /** Idempotency keys of unconfirmed departures, by session. */
  const [keys, setKeys] = useState<ReadonlyMap<string, string>>(new Map());

  const mutation = useMutation<void, SessionActionError, LeaveWaitlistRequest>({
    mutationFn: async (request) => {
      let result: Awaited<ReturnType<LeaveWaitlist>>;
      try {
        result = await leaveWaitlist(request);
      } catch {
        throw new SessionActionError({ status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_MESSAGE, unconfirmed: true });
      }
      if (result.status === "error") throw new SessionActionError(result);
    },
    retry: false,
    onSuccess: (_result, request) => {
      setKeys((current) => without(current, request.sessionId));
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: joinedSessionsQueryKey });
    },
    onError: (error, request) => {
      setKeys((current) => error.unconfirmed ? new Map(current).set(request.sessionId, request.idempotencyKey) : without(current, request.sessionId));
    },
  });

  const state: LeaveWaitlistState = selected === null
    ? { step: "closed" }
    : {
        step: "confirming", session: selected, submitting: mutation.isPending,
        error: mutation.isError && mutation.variables?.sessionId === selected.sessionId ? mutation.error.message : null,
      };

  return {
    state,
    start: (session) => {
      if (mutation.isPending) return;
      mutation.reset();
      setSelected(session);
    },
    confirm: () => {
      if (selected === null || mutation.isPending) return;
      mutation.mutate({ sessionId: selected.sessionId, idempotencyKey: keys.get(selected.sessionId) ?? crypto.randomUUID() });
    },
    close: () => { if (!mutation.isPending) setSelected(null); },
  };
}

function without(map: ReadonlyMap<string, string>, key: string): ReadonlyMap<string, string> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}
