"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { PreviewUnavailableError, SessionActionError } from "./withdrawal-errors";
import type { JoinedSessionItem, PreviewWithdrawal, Replacement, WithdrawFromSession, WithdrawRequest, WithdrawalPreview } from "./withdrawal-ports";
import { joinedSessionsQueryKey, walletQueryKey, withdrawalPreviewQueryKey } from "./withdrawal-query-keys";

type Withdrawn = Extract<Awaited<ReturnType<WithdrawFromSession>>, { status: "withdrawn" }>;

/** An attempt that may have happened: the exact request to replay, and the refund shown for it. */
interface Unresolved {
  readonly request: WithdrawRequest;
  readonly preview: WithdrawalPreview;
}

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
const sameTerms = (a: WithdrawalPreview, b: WithdrawalPreview) => a.kind === b.kind && a.refundCents === b.refundCents && a.heldCents === b.heldCents;

/**
 * UC2-05 withdrawal for one dialog shared by every session in the list. React Query owns the
 * server state: the refund preview (`useQuery`), the withdrawal (`useMutation`) and refreshing
 * the joined sessions and wallet afterwards. This hook keeps only the interaction state: the
 * selected session, the replacement choice, unresolved requests and whether the terms changed.
 *
 * The refund is checked again just before withdrawing, because it changes at the 30-hour cutoff.
 * An unresolved request is kept per session and replayed exactly, without another preview.
 */
export function useWithdrawalFlow({ previewWithdrawal, withdraw }: {
  readonly previewWithdrawal: PreviewWithdrawal;
  readonly withdraw: WithdrawFromSession;
}): WithdrawalFlow {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<JoinedSessionItem | null>(null);
  const [mode, setMode] = useState<Replacement["mode"] | null>(null);
  const [inviteeId, setInviteeId] = useState<string | null>(null);
  const [termsChanged, setTermsChanged] = useState(false);
  const [checking, setChecking] = useState(false);
  const [unresolved, setUnresolved] = useState<ReadonlyMap<string, Unresolved>>(new Map());
  /** The attempt being sent, for the result screen and in case it ends unconfirmed. */
  const [attempt, setAttempt] = useState<Unresolved | null>(null);
  const attemptRef = useRef<Unresolved | null>(null);

  const sessionId = selected?.sessionId ?? "";
  const pending = selected === null ? undefined : unresolved.get(selected.sessionId);
  const loadPreview = (id: string) => async () => {
    const result = await previewWithdrawal(id);
    if (result.status === "error") throw new PreviewUnavailableError(result.message);
    return result.preview;
  };

  // No preview while a request is unresolved: the place may already be withdrawn, so it would fail.
  const preview = useQuery({
    queryKey: withdrawalPreviewQueryKey(sessionId),
    queryFn: loadPreview(sessionId),
    enabled: selected !== null && pending === undefined,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

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
      setUnresolved((current) => without(current, request.sessionId));
      void queryClient.invalidateQueries({ queryKey: joinedSessionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: walletQueryKey });
    },
    onError: (error, request) => {
      const sent = attemptRef.current;
      if (error.unconfirmed && sent !== null) {
        setUnresolved((current) => new Map(current).set(request.sessionId, sent));
      } else {
        setUnresolved((current) => without(current, request.sessionId));
        setMode(null);
        setInviteeId(null);
      }
    },
  });

  function send(next: Unresolved) {
    attemptRef.current = next;
    setAttempt(next);
    mutation.mutate(next.request);
  }

  async function confirm() {
    if (selected === null || mutation.isPending || checking) return;
    if (pending !== undefined) {
      send(pending);
      return;
    }
    const shown = preview.data;
    const replacement: Replacement | null = mode === "OPEN_SLOT" ? { mode }
      : mode === "DIRECT_INVITE" && inviteeId !== null ? { mode, inviteeId } : null;
    if (shown === undefined || replacement === null) return;
    mutation.reset();
    setChecking(true);
    let latest: WithdrawalPreview;
    try {
      // Updates the shown preview too, so changed terms are what the player sees next.
      latest = await queryClient.fetchQuery({ queryKey: withdrawalPreviewQueryKey(selected.sessionId), queryFn: loadPreview(selected.sessionId), staleTime: 0 });
    } catch {
      return; // The preview query now shows the failure with "Try again"; nothing was sent.
    } finally {
      setChecking(false);
    }
    if (!sameTerms(latest, shown)) {
      setTermsChanged(true);
      return;
    }
    setTermsChanged(false);
    send({ preview: latest, request: { sessionId: selected.sessionId, idempotencyKey: crypto.randomUUID(), replacement } });
  }

  const forSelected = selected !== null && mutation.variables?.sessionId === selected.sessionId;
  let state: WithdrawalState;
  if (selected === null) {
    state = { step: "closed" };
  } else if (forSelected && mutation.isSuccess && attempt !== null) {
    state = { step: "withdrawn", session: selected, preview: attempt.preview, request: attempt.request, result: mutation.data };
  } else if (pending !== undefined) {
    state = {
      step: "unconfirmed", session: selected, preview: pending.preview, request: pending.request, submitting: mutation.isPending,
      message: forSelected && mutation.isError ? mutation.error.message : "Your last withdrawal wasn't confirmed. Retry it to finish.",
    };
  } else if (preview.isError) {
    state = { step: "preview-failed", session: selected, message: preview.error instanceof PreviewUnavailableError ? preview.error.message : "We couldn't check your refund. Please try again." };
  } else if (preview.data === undefined) {
    state = { step: "loading", session: selected };
  } else {
    state = {
      step: "choosing", session: selected, preview: preview.data, mode, inviteeId, termsChanged,
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
      // The refund is time-sensitive: drop this preview, including a request still running, so
      // reopening asks the server again and a late answer is ignored.
      queryClient.removeQueries({ queryKey: withdrawalPreviewQueryKey(selected.sessionId) });
      setSelected(null);
    },
  };
}

function without(map: ReadonlyMap<string, Unresolved>, key: string): ReadonlyMap<string, Unresolved> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}
