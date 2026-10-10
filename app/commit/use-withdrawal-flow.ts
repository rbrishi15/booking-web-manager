"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { PreviewUnavailableError, SessionActionError } from "./withdrawal-errors";
import type { JoinedSessionItem, PreviewWithdrawal, Replacement, WithdrawFromSession, WithdrawRequest, WithdrawalPreview } from "./withdrawal-ports";
import { joinedSessionsQueryKey, walletQueryKey, withdrawalPreviewQueryKey } from "./withdrawal-query-keys";
import {
  browserUnresolvedStore, reconcile, settleAttempt, termsDiffer, unresolvedWithdrawalSchema,
  type AttemptOutcome, type UnresolvedStore, type UnresolvedWithdrawal,
} from "./withdrawal-recovery";

type Withdrawn = Extract<Awaited<ReturnType<WithdrawFromSession>>, { status: "withdrawn" }>;

/** Everything the withdrawal dialog shows. `closed` means no dialog. */
export type WithdrawalState =
  | { readonly step: "closed" }
  | { readonly step: "loading"; readonly session: JoinedSessionItem }
  | { readonly step: "preview-failed"; readonly session: JoinedSessionItem; readonly message: string }
  | {
      readonly step: "choosing";
      readonly session: JoinedSessionItem;
      readonly preview: WithdrawalPreview;
      readonly mode: Replacement["mode"] | null;
      readonly inviteeId: string | null;
      readonly submitting: boolean;
      /** The refund changed while the dialog was open; the player must confirm again. */
      readonly termsChanged: boolean;
      readonly error: string | null;
    }
  | {
      /** The last attempt may have happened. Only the exact same request can be sent again. */
      readonly step: "unconfirmed";
      readonly session: JoinedSessionItem;
      readonly preview: WithdrawalPreview;
      readonly request: WithdrawRequest;
      readonly submitting: boolean;
      readonly message: string;
    }
  | { readonly step: "withdrawn"; readonly session: JoinedSessionItem; readonly preview: WithdrawalPreview; readonly request: WithdrawRequest; readonly result: Withdrawn };

export interface WithdrawalFlow {
  readonly state: WithdrawalState;
  readonly start: (session: JoinedSessionItem) => void;
  readonly chooseMode: (mode: Replacement["mode"]) => void;
  readonly chooseInvitee: (inviteeId: string) => void;
  readonly confirm: () => void;
  readonly retryPreview: () => void;
  readonly close: () => void;
}

const UNCONFIRMED_MESSAGE = "We couldn't confirm whether you withdrew. Try again: the same request is reused, so nothing happens twice.";

/**
 * UC2-05 withdrawal for one dialog shared by every session in the list. React Query owns the
 * server state: the refund preview (`useQuery`), the withdrawal (`useMutation`) and refreshing
 * the joined sessions and wallet afterwards. This hook keeps the interaction state: the selected
 * session, the replacement choice, the terms the player was shown, and unresolved requests.
 *
 * - The refund shown is a snapshot: React Query never replaces it in the background (focus and
 *   reconnect refetches are off), and it is checked against the server just before
 *   withdrawing; if it changed, the player must confirm the new terms.
 * - Unresolved requests follow `withdrawal-recovery.ts`: kept per user, saved across reloads,
 *   replayed exactly, and cleared only once their outcome is established.
 */
export function useWithdrawalFlow({ userId, sessions, previewWithdrawal, withdraw, store: givenStore }: {
  readonly userId: string;
  /** The server's current joined-sessions list, used to establish unresolved outcomes. */
  readonly sessions: readonly JoinedSessionItem[] | undefined;
  readonly previewWithdrawal: PreviewWithdrawal;
  readonly withdraw: WithdrawFromSession;
  /** Injected in stories and tests; defaults to this browser's storage for the user. */
  readonly store?: UnresolvedStore<UnresolvedWithdrawal>;
}): WithdrawalFlow {
  const queryClient = useQueryClient();
  const [store] = useState(() => givenStore ?? browserUnresolvedStore("withdrawals", userId, unresolvedWithdrawalSchema));
  const [selected, setSelected] = useState<JoinedSessionItem | null>(null);
  const [mode, setMode] = useState<Replacement["mode"] | null>(null);
  const [inviteeId, setInviteeId] = useState<string | null>(null);
  /** The refund the player was shown and is confirming against. */
  const [presented, setPresented] = useState<WithdrawalPreview | null>(null);
  const [termsChanged, setTermsChanged] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(() => store.load());
  /** The attempt being sent, for the result screen and to settle it afterwards. */
  const [attempt, setAttempt] = useState<{ readonly entry: UnresolvedWithdrawal; readonly retry: boolean } | null>(null);
  const attemptRef = useRef<{ readonly entry: UnresolvedWithdrawal; readonly retry: boolean } | null>(null);

  const unresolved = reconcile(saved, sessions, "COMMITTED");
  useEffect(() => { store.save(unresolved); }, [store, unresolved]);

  const sessionId = selected?.sessionId ?? "";
  const pending = selected === null ? undefined : unresolved.get(selected.sessionId);
  const loadPreview = (id: string) => async () => {
    const result = await previewWithdrawal(id);
    if (result.status === "error") throw new PreviewUnavailableError(result.message);
    return result.preview;
  };

  // No preview while a request is unresolved: the place may already be withdrawn, so it would fail.
  const preview = useQuery({
    queryKey: withdrawalPreviewQueryKey(userId, sessionId),
    queryFn: async () => {
      const result = await loadPreview(sessionId)();
      setPresented((shown) => shown ?? result);
      return result;
    },
    enabled: selected !== null && pending === undefined,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    // The refund is only refreshed when the player acts, never silently in the background.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const settle = (request: WithdrawRequest, outcome: AttemptOutcome) => {
    const sent = attemptRef.current;
    if (sent === null) return;
    setSaved((current) => settleAttempt(reconcile(current, sessions, "COMMITTED"), request.sessionId, sent.entry, outcome, sent.retry));
  };

  const mutation = useMutation<Withdrawn, SessionActionError, WithdrawRequest>({
    mutationFn: async (request) => {
      let result: Awaited<ReturnType<WithdrawFromSession>>;
      try {
        result = await withdraw(request);
      } catch {
        throw new SessionActionError({ status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_MESSAGE, unconfirmed: true });
      }
      if (result.status === "error") throw new SessionActionError(result);
      return result;
    },
    retry: false,
    onSuccess: (_result, request) => {
      settle(request, "succeeded");
      void queryClient.invalidateQueries({ queryKey: joinedSessionsQueryKey(userId) });
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    },
    onError: (error, request) => {
      settle(request, error.unconfirmed ? "unconfirmed" : "rejected");
      if (!error.unconfirmed && !attemptRef.current?.retry) {
        setMode(null);
        setInviteeId(null);
      }
    },
  });

  function send(entry: UnresolvedWithdrawal, retry: boolean) {
    attemptRef.current = { entry, retry };
    setAttempt({ entry, retry });
    mutation.mutate(entry.request);
  }

  async function confirm() {
    if (selected === null || mutation.isPending || checking) return;
    if (pending !== undefined) {
      send(pending, true);
      return;
    }
    const shown = presented;
    const replacement: Replacement | null = mode === "OPEN_SLOT" ? { mode }
      : mode === "DIRECT_INVITE" && inviteeId !== null ? { mode, inviteeId } : null;
    if (shown === null || replacement === null) return;
    mutation.reset();
    setChecking(true);
    let latest: WithdrawalPreview;
    try {
      latest = await queryClient.fetchQuery({ queryKey: withdrawalPreviewQueryKey(userId, selected.sessionId), queryFn: loadPreview(selected.sessionId), staleTime: 0 });
    } catch {
      return; // The preview query now shows the failure with "Try again"; nothing was sent.
    } finally {
      setChecking(false);
    }
    if (termsDiffer(shown, latest)) {
      setPresented(latest);
      setTermsChanged(true);
      return;
    }
    setTermsChanged(false);
    send({ preview: shown, request: { sessionId: selected.sessionId, idempotencyKey: crypto.randomUUID(), replacement } }, false);
  }

  const forSelected = selected !== null && mutation.variables?.sessionId === selected.sessionId;
  let state: WithdrawalState;
  if (selected === null) {
    state = { step: "closed" };
  } else if (forSelected && mutation.isSuccess && attempt !== null) {
    state = { step: "withdrawn", session: selected, preview: attempt.entry.preview, request: attempt.entry.request, result: mutation.data };
  } else if (pending !== undefined) {
    state = {
      step: "unconfirmed", session: selected, preview: pending.preview, request: pending.request, submitting: mutation.isPending,
      message: forSelected && mutation.isError ? mutation.error.message : "Your last withdrawal wasn't confirmed. Retry it to finish.",
    };
  } else if (preview.isError) {
    state = { step: "preview-failed", session: selected, message: preview.error instanceof PreviewUnavailableError ? preview.error.message : "We couldn't check your refund. Please try again." };
  } else if (presented === null) {
    state = { step: "loading", session: selected };
  } else {
    state = {
      step: "choosing", session: selected, preview: presented, mode, inviteeId, termsChanged,
      submitting: checking || mutation.isPending,
      error: forSelected && mutation.isError && !mutation.error.unconfirmed ? mutation.error.message : null,
    };
  }

  return {
    state,
    start: (session) => {
      if (mutation.isPending || checking) return;
      mutation.reset();
      setSelected(session);
      setMode(null);
      setInviteeId(null);
      setPresented(null);
      setTermsChanged(false);
    },
    chooseMode: (next) => {
      setMode(next);
      if (next === "OPEN_SLOT") setInviteeId(null);
    },
    chooseInvitee: setInviteeId,
    confirm: () => { void confirm(); },
    retryPreview: () => { void preview.refetch(); },
    close: () => {
      if (mutation.isPending || checking || selected === null) return;
      // Drop this preview, including a request still running, so reopening asks the server again
      // and a late answer is ignored.
      queryClient.removeQueries({ queryKey: withdrawalPreviewQueryKey(userId, selected.sessionId) });
      setSelected(null);
    },
  };
}
