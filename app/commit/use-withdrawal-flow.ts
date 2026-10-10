"use client";

import { useRef, useState } from "react";
import type {
  ActionError, JoinedSessionItem, PreviewWithdrawal, Replacement, WithdrawFromSession, WithdrawRequest, WithdrawalPreview,
} from "./withdrawal-ports";

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

const sameTerms = (a: WithdrawalPreview, b: WithdrawalPreview) => a.kind === b.kind && a.refundCents === b.refundCents && a.heldCents === b.heldCents;

/**
 * UC2-05 withdrawal interaction state and async coordination, for one dialog shared by every
 * session in the list. The refund is always the server's: it is shown before anything happens and
 * checked again just before withdrawing, because it changes at the 30-hour cutoff. An unconfirmed
 * request is kept per session and replayed exactly, without needing another preview.
 */
export function useWithdrawalFlow({ previewWithdrawal, withdraw, onWithdrawn }: {
  readonly previewWithdrawal: PreviewWithdrawal;
  readonly withdraw: WithdrawFromSession;
  /** Called when the player closes the dialog after withdrawing, to reload their sessions. */
  readonly onWithdrawn: () => void;
}): WithdrawalFlow {
  const [state, setState] = useState<WithdrawalState>({ step: "closed" });
  /** Unconfirmed requests, by session, kept until the server answers them. */
  const unconfirmed = useRef(new Map<string, { readonly request: WithdrawRequest; readonly preview: WithdrawalPreview }>());
  /** Numbers each preview request; only the latest may update the dialog. */
  const previewRequest = useRef(0);
  const busy = useRef(false);

  async function loadPreview(session: JoinedSessionItem) {
    const request = ++previewRequest.current;
    setState({ step: "loading", session });
    let result: Awaited<ReturnType<PreviewWithdrawal>>;
    try {
      result = await previewWithdrawal(session.sessionId);
    } catch {
      result = { status: "error", message: "We couldn't check your refund. Please try again." };
    }
    if (request !== previewRequest.current) return;
    setState(result.status === "ready"
      ? { step: "choosing", session, preview: result.preview, mode: null, inviteeId: null, submitting: false, termsChanged: false, error: null }
      : { step: "preview-failed", session, message: result.message });
  }

  function start(session: JoinedSessionItem) {
    const pending = unconfirmed.current.get(session.sessionId);
    if (pending) {
      previewRequest.current += 1;
      setState({ step: "unconfirmed", session, ...pending, submitting: false, message: "Your last withdrawal wasn't confirmed. Retry it to finish." });
      return;
    }
    void loadPreview(session);
  }

  const update = (change: Partial<Extract<WithdrawalState, { step: "choosing" }>>) =>
    setState((current) => current.step === "choosing" && !current.submitting ? { ...current, ...change, error: null } : current);

  async function send(session: JoinedSessionItem, preview: WithdrawalPreview, request: WithdrawRequest) {
    let result: Awaited<ReturnType<WithdrawFromSession>>;
    try {
      result = await withdraw(request);
    } catch {
      result = { status: "error", code: "UNKNOWN_RESULT", message: "We couldn't confirm whether you withdrew. Try again: the same request is reused, so nothing happens twice.", unconfirmed: true };
    }
    if (result.status === "withdrawn") {
      unconfirmed.current.delete(session.sessionId);
      setState({ step: "withdrawn", session, preview, request, result });
    } else if (result.unconfirmed) {
      unconfirmed.current.set(session.sessionId, { request, preview });
      setState({ step: "unconfirmed", session, preview, request, submitting: false, message: result.message });
    } else {
      unconfirmed.current.delete(session.sessionId);
      rejected(session, preview, result);
    }
  }

  function rejected(session: JoinedSessionItem, preview: WithdrawalPreview, result: ActionError) {
    setState({ step: "choosing", session, preview, mode: null, inviteeId: null, submitting: false, termsChanged: false, error: result.message });
  }

  async function confirm() {
    if (busy.current) return;
    const current = state;
    if (current.step === "unconfirmed") {
      busy.current = true;
      setState({ ...current, submitting: true });
      try { await send(current.session, current.preview, current.request); } finally { busy.current = false; }
      return;
    }
    if (current.step !== "choosing") return;
    const replacement: Replacement | null = current.mode === "OPEN_SLOT" ? { mode: "OPEN_SLOT" }
      : current.mode === "DIRECT_INVITE" && current.inviteeId !== null ? { mode: "DIRECT_INVITE", inviteeId: current.inviteeId } : null;
    if (replacement === null) return;
    busy.current = true;
    setState({ ...current, submitting: true, error: null });
    try {
      // The refund depends on time to start, so check it again just before withdrawing.
      let latest: Awaited<ReturnType<PreviewWithdrawal>>;
      try {
        latest = await previewWithdrawal(current.session.sessionId);
      } catch {
        latest = { status: "error", message: "We couldn't recheck your refund. Nothing has changed; please try again." };
      }
      if (latest.status === "error") {
        setState({ ...current, submitting: false, error: latest.message });
        return;
      }
      if (!sameTerms(latest.preview, current.preview)) {
        setState({ ...current, preview: latest.preview, submitting: false, termsChanged: true, error: null });
        return;
      }
      await send(current.session, current.preview, { sessionId: current.session.sessionId, idempotencyKey: crypto.randomUUID(), replacement });
    } finally {
      busy.current = false;
    }
  }

  function close() {
    if (busy.current) return;
    previewRequest.current += 1;
    const withdrawn = state.step === "withdrawn";
    setState({ step: "closed" });
    if (withdrawn) onWithdrawn();
  }

  return {
    state,
    start,
    chooseMode: (mode) => update(mode === "OPEN_SLOT" ? { mode, inviteeId: null } : { mode }),
    chooseInvitee: (inviteeId) => update({ inviteeId }),
    confirm: () => { void confirm(); },
    retryPreview: () => { if (state.step === "preview-failed") void loadPreview(state.session); },
    close,
  };
}
