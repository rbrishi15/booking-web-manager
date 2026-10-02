"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { Money } from "@/components/ui/money";
import type { CancellationOutcome, CancellationPreviewOutcome } from "../cancellation-actions";
import type { SessionCancellationPreview } from "@/use-cases/sessions/PreviewSessionCancellation";
import type { SessionCancellationResult } from "@/use-cases/sessions/session-cancellation-transaction";
import type { HostedSessionItem } from "../types";

export interface CancellationTransport {
  readonly userId: string;
  readonly preview: (sessionId: string) => Promise<CancellationPreviewOutcome>;
  readonly cancel: (sessionId: string, submission: { idempotencyKey: string; previewVersion: string }) => Promise<CancellationOutcome>;
}

const storedRequest = z.object({
  sessionId: z.string().uuid(), venueName: z.string(),
  idempotencyKey: z.string().uuid(), previewVersion: z.string().regex(/^[a-f0-9]{64}$/),
});
type PendingCancellation = z.infer<typeof storedRequest>;

/** Keeps a confirmed financial request recoverable even after its card disappears. */
export function SessionCancellationDialog({ selected, transport, onClose, onRestoreFocus, onCancelled, onRefresh }: {
  readonly selected: HostedSessionItem | null;
  readonly transport: CancellationTransport;
  readonly onClose: () => void;
  readonly onRestoreFocus: () => void;
  readonly onCancelled: (result: SessionCancellationResult) => void;
  readonly onRefresh: () => void;
}) {
  const storageKey = `session-cancellation:${transport.userId}`;
  const [recovery, setRecovery] = useState<PendingCancellation | null>(null);
  const [preview, setPreview] = useState<SessionCancellationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retryPreview, setRetryPreview] = useState(0);
  const busy = useRef(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const value = sessionStorage.getItem(storageKey);
      if (value) {
        const parsed = storedRequest.safeParse(JSON.parse(value));
        if (parsed.success) setRecovery(parsed.data);
        else sessionStorage.removeItem(storageKey);
      }
    } catch { /* Storage restrictions do not block in-memory retries. */ }
  }, [storageKey]);

  const selectedId = selected?.sessionId;
  const fetchPreview = transport.preview;
  useEffect(() => { setMessage(null); }, [selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    let current = true;
    setDismissed(false);
    setPreview(null);
    // A confirmed request must be retried as-is, even when lifecycle changed.
    if (recovery) return;
    setLoading(true);
    void fetchPreview(selectedId).then((outcome) => {
      if (!current) return;
      if (outcome.status === "ready") setPreview(outcome.preview);
      else setMessage(outcome.message);
    }).catch(() => {
      if (current) setMessage("We couldn't load the refunds. Please try again.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [selectedId, fetchPreview, retryPreview, recovery]);

  function retain(request: PendingCancellation | null) {
    setRecovery(request);
    try {
      if (request) sessionStorage.setItem(storageKey, JSON.stringify(request));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Keep the same request in memory when storage is unavailable. */ }
  }

  async function confirm() {
    if (busy.current || (!recovery && (!preview || !selected))) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    const request = recovery ?? {
      sessionId: selected!.sessionId, venueName: selected!.venueName,
      previewVersion: preview!.previewVersion, idempotencyKey: crypto.randomUUID(),
    };
    retain(request);
    try {
      const outcome = await transport.cancel(request.sessionId, {
        idempotencyKey: request.idempotencyKey, previewVersion: request.previewVersion,
      });
      if (outcome.status === "cancelled") {
        retain(null);
        onCancelled(outcome.result);
        onClose();
        onRefresh();
      } else {
        setMessage(outcome.message);
        if (!outcome.retrySameRequest) {
          retain(null);
          setPreview(null);
          if (outcome.code === "STALE_CANCELLATION_PREVIEW") setRetryPreview((value) => value + 1);
        }
        if (outcome.refresh) onRefresh();
      }
    } catch {
      setMessage("We couldn't confirm the result. Retry this cancellation using the saved request.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const open = selected !== null || (recovery !== null && !dismissed);
  return (
    <>
      {recovery && selected === null && dismissed && <div role="status" className="mb-4 rounded-lg border p-4">
        <p>A cancellation for {recovery.venueName} needs confirmation of its result.</p>
        <Button variant="outline" className="mt-2" onClick={() => { setDismissed(false); setMessage(null); }}>Check cancellation result</Button>
      </div>}
      <Dialog open={open} onOpenChange={(next) => {
        if (pending) return;
        if (!next) { setDismissed(true); setMessage(null); onClose(); }
      }}>
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}>
          <DialogHeader>
            <DialogTitle>{recovery ? "Check cancellation result" : "Cancel session?"}</DialogTitle>
            <DialogDescription>
              {recovery?.venueName ?? selected?.venueName}. Refunds return to participants' in-app wallets.
              You must handle the venue booking cancellation separately.
            </DialogDescription>
          </DialogHeader>
          {loading && <p role="status">Calculating refunds…</p>}
          {preview && !recovery && <div className="space-y-3">
            <p>{preview.affectedParticipantCount} participants are affected.
              {" "}{preview.refundRecipientCount} participants will receive a refund.</p>
            <div className="rounded-lg bg-secondary p-4 text-center">
              <p className="text-sm text-muted-foreground">Total wallet refunds</p>
              <Money cents={preview.totalRefundCents} className="text-3xl font-bold" />
            </div>
            <p className="text-sm text-muted-foreground">This cannot be undone. Previously removed or cancelled records are retained.</p>
          </div>}
          {recovery && <p className="text-sm">Retry the cancellation you already confirmed. The same request is reused to prevent duplicate refunds.</p>}
          {message && <ErrorMessage>{message}</ErrorMessage>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" disabled={pending} onClick={() => { setDismissed(true); onClose(); setMessage(null); }}>{recovery ? "Close" : "Keep session"}</Button>
            {!preview && !recovery && !loading && <Button variant="outline" onClick={() => { setMessage(null); setRetryPreview((value) => value + 1); }}>Retry preview</Button>}
            <Button variant="destructive" disabled={pending || loading || (!preview && !recovery)} onClick={confirm}>
              {pending ? "Cancelling…" : recovery ? "Retry cancellation" : "Confirm cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
