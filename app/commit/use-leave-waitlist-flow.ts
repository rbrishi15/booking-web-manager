"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { SessionActionError } from "./withdrawal-errors";
import type { JoinedSessionItem, LeaveWaitlist, LeaveWaitlistRequest } from "./withdrawal-ports";
import { joinedSessionsQueryKey } from "./withdrawal-query-keys";
import {
  browserUnresolvedStore, reconcile, settleAttempt, unresolvedDepartureSchema, type AttemptOutcome, type UnresolvedStore,
} from "./withdrawal-recovery";

/** Everything the leave-waitlist dialog shows. `closed` means no dialog. */
export type LeaveWaitlistState =
  | { readonly step: "closed" }
  | {
      readonly step: "confirming";
      readonly session: JoinedSessionItem;
      readonly submitting: boolean;
      readonly error: string | null;
      /** A departure for this session may already have happened; only its retry can be sent. */
      readonly unresolved: boolean;
    };

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
 * session and unresolved departures' idempotency keys, following `withdrawal-recovery.ts`
 * (per user, saved across reloads, cleared only once the outcome is established).
 */
export function useLeaveWaitlistFlow({ userId, sessions, leaveWaitlist, store: givenStore }: {
  readonly userId: string;
  /** The server's current joined-sessions list, used to establish unresolved outcomes. */
  readonly sessions: readonly JoinedSessionItem[] | undefined;
  readonly leaveWaitlist: LeaveWaitlist;
  /** Injected in stories and tests; defaults to this browser's storage for the user. */
  readonly store?: UnresolvedStore<string>;
}): LeaveWaitlistFlow {
  const queryClient = useQueryClient();
  const [store] = useState(() => givenStore ?? browserUnresolvedStore("waitlist-departures", userId, unresolvedDepartureSchema));
  const [selected, setSelected] = useState<JoinedSessionItem | null>(null);
  const [saved, setSaved] = useState(() => store.load());
  const retrying = useRef(false);

  const keys = reconcile(saved, sessions, "WAITLISTED");
  useEffect(() => { store.save(keys); }, [store, keys]);

  const settle = (request: LeaveWaitlistRequest, outcome: AttemptOutcome) =>
    setSaved((current) => settleAttempt(reconcile(current, sessions, "WAITLISTED"), request.sessionId, request.idempotencyKey, outcome, retrying.current));

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
      settle(request, "succeeded");
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: joinedSessionsQueryKey(userId) });
    },
    onError: (error, request) => settle(request, error.unconfirmed ? "unconfirmed" : "rejected"),
  });

  const state: LeaveWaitlistState = selected === null
    ? { step: "closed" }
    : {
        step: "confirming", session: selected, submitting: mutation.isPending, unresolved: keys.has(selected.sessionId),
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
      const savedKey = keys.get(selected.sessionId);
      retrying.current = savedKey !== undefined;
      mutation.mutate({ sessionId: selected.sessionId, idempotencyKey: savedKey ?? crypto.randomUUID() });
    },
    close: () => { if (!mutation.isPending) setSelected(null); },
  };
}
