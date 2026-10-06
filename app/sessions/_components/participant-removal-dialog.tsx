"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { Money } from "@/components/ui/money";
import type { ParticipantRemovalOutcome, ParticipantRemovalPreviewOutcome } from "../removal-actions";
import { participantRemovalStorageKey, readPendingParticipantRemoval, type PendingParticipantRemoval } from "./participant-removal-storage";

type RemovalPreview = Extract<ParticipantRemovalPreviewOutcome, { status: "ready" }>["preview"];
export type RemovalResult = Extract<ParticipantRemovalOutcome, { status: "removed" }>["result"];
export interface RemovalTarget {
  readonly participationId: string;
  readonly displayName: string;
}
export interface ParticipantRemovalTransport {
  readonly userId: string;
  readonly preview: (sessionId: string, participationId: string) => Promise<ParticipantRemovalPreviewOutcome>;
  readonly remove: (sessionId: string, participationId: string, submission: { idempotencyKey: string; previewVersion: string }) => Promise<ParticipantRemovalOutcome>;
}

/** Previews one refund and durably retains the confirmed request until its outcome is known. */
export function ParticipantRemovalDialog({ sessionId, selected, transport, onClose, onRestoreFocus, onRemoved, onRefresh, onRecoveryChange }: {
  readonly sessionId: string;
  readonly selected: RemovalTarget | null;
  readonly transport: ParticipantRemovalTransport;
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
  readonly onRemoved: (result: RemovalResult, displayName: string) => void;
  readonly onRefresh: () => void;
  readonly onRecoveryChange: (locked: boolean) => void;
}) {
  const storageKey = participantRemovalStorageKey(transport.userId, sessionId);
  const [recovery, setRecovery] = useState<PendingParticipantRemoval | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retryPreview, setRetryPreview] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    setStorageLoaded(false);
    setRecovery(null);
    setStorageIssue(null);
    try {
      const value = sessionStorage.getItem(storageKey);
      if (value !== null) {
        const request = readPendingParticipantRemoval(value, transport.userId, sessionId);
        if (request) setRecovery(request);
        else setStorageIssue("A saved removal request could not be read safely. It has been kept. Reload or contact support before removing another participant.");
      }
    } catch {
      setStorageIssue("Your browser could not read saved removal requests. Enable session storage, then try again.");
    } finally {
      setStorageLoaded(true);
    }
  }, [storageKey, transport.userId, sessionId, readAttempt]);

  useEffect(() => {
    onRecoveryChange(!storageLoaded || recovery !== null || storageIssue !== null);
  }, [storageLoaded, recovery, storageIssue, onRecoveryChange]);

  const selectedId = selected?.participationId;
  const fetchPreview = transport.preview;
  useEffect(() => { setMessage(null); if (selectedId) setDismissed(false); }, [selectedId]);
  useEffect(() => {
    setPreview(null);
    setLoading(false);
    if (!selectedId || !storageLoaded || recovery || storageIssue) return;
    let current = true;
    setLoading(true);
    void fetchPreview(sessionId, selectedId).then((outcome) => {
      if (!current) return;
      if (outcome.status === "ready") setPreview(outcome.preview);
      else setMessage(outcome.message);
    }).catch(() => {
      if (current) setMessage("We couldn't load the refund. Please try again.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [sessionId, selectedId, fetchPreview, retryPreview, recovery, storageLoaded, storageIssue]);

  function clearKnownRequest() {
    setRecovery(null);
    try { sessionStorage.removeItem(storageKey); } catch { /* A known result is safe to replay if storage becomes readable later. */ }
  }

  async function confirm() {
    if (busy.current || !storageLoaded || storageIssue || (!recovery && (!preview || !selected))) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    const request: PendingParticipantRemoval = recovery ?? {
      userId: transport.userId, sessionId, participationId: selected!.participationId,
      displayName: selected!.displayName, refundCents: preview!.refundCents,
      previewVersion: preview!.previewVersion, idempotencyKey: crypto.randomUUID(),
    };
    setRecovery(request);
    try {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(request));
      } catch {
        setMessage("Your browser couldn't save this request, so removal was not sent. Enable session storage and retry the same request.");
        return;
      }
      const outcome = await transport.remove(request.sessionId, request.participationId, {
        idempotencyKey: request.idempotencyKey, previewVersion: request.previewVersion,
      });
      if (outcome.status === "removed") {
        clearKnownRequest();
        setDismissed(true);
        onRemoved(outcome.result, request.displayName);
        onClose();
        onRefresh();
      } else {
        setMessage(outcome.message);
        // Authority checks can fail before replay lookup, so they cannot resolve an earlier attempt.
        const authorityUnresolved = outcome.code === "UNAUTHENTICATED" || outcome.code === "INACTIVE_ACCOUNT"
          || (recovery !== null && (outcome.code === "UNAUTHORIZED" || outcome.code === "NOT_FOUND"));
        if (!outcome.retrySameRequest && !authorityUnresolved) {
          clearKnownRequest();
          setPreview(null);
          setRetryPreview((value) => value + 1);
        }
        if (outcome.refresh) onRefresh();
      }
    } catch {
      setMessage("We couldn't confirm the result. Retry this removal using the saved request.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function close() {
    if (pending) return;
    setDismissed(true);
    setMessage(null);
    onClose();
  }

  return <>
    {storageIssue && <div className="mb-4 space-y-3">
      <ErrorMessage>{storageIssue}</ErrorMessage>
      <Button variant="outline" onClick={() => setReadAttempt((value) => value + 1)}>Read saved request again</Button>
    </div>}
    {recovery && selected === null && dismissed && <div role="status" className="mb-4 rounded-lg border p-4">
      <p>The removal of {recovery.displayName} needs confirmation of its result.</p>
      <Button variant="outline" className="mt-2" onClick={() => { setDismissed(false); setMessage(null); }}>Check removal result</Button>
    </div>}
    <Dialog open={selected !== null || (recovery !== null && !dismissed)} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}
        onInteractOutside={(event) => { if (pending) event.preventDefault(); }}
        onCloseAutoFocus={(event) => { event.preventDefault(); onRestoreFocus(); }}>
        <DialogHeader>
          <DialogTitle>{recovery ? "Check removal result" : "Remove participant?"}</DialogTitle>
          <DialogDescription className="break-words">
            {recovery?.displayName ?? selected?.displayName} will receive the full held amount in their in-app wallet.
            Removal prevents them from rejoining this session.
          </DialogDescription>
        </DialogHeader>
        {loading && <p role="status">Calculating refund…</p>}
        {(preview || recovery) && <div className="rounded-lg bg-secondary p-4 text-center">
          <p className="text-sm text-muted-foreground">Wallet refund</p>
          <Money cents={recovery?.refundCents ?? preview!.refundCents} className="text-3xl font-bold" />
        </div>}
        {recovery ? <p className="text-sm">Check the removal you already confirmed. The saved request is reused to prevent duplicate refunds.</p>
          : preview && <p className="text-sm text-muted-foreground">This cannot be undone. The slot becomes available; waitlisted participants are not automatically promoted.</p>}
        {message && <ErrorMessage>{message}</ErrorMessage>}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={pending} onClick={close}>{recovery ? "Close for now" : "Keep participant"}</Button>
          {!preview && !recovery && !loading && <Button variant="outline" onClick={() => { setMessage(null); setRetryPreview((value) => value + 1); }}>Retry preview</Button>}
          <Button variant="destructive" disabled={pending || loading || !storageLoaded || !!storageIssue || (!preview && !recovery)} onClick={confirm}>
            {pending ? "Removing…" : recovery ? "Retry removal" : "Confirm removal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
