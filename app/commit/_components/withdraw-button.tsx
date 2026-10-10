"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import type {
  JoinedSessionItem, PreviewWithdrawal, Replacement, ReplacementCandidate, WithdrawFromSession, WithdrawRequest, WithdrawalPreview,
} from "../withdrawal-ports";
import { singaporeStart } from "./joined-session-format";

type PreviewState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly preview: WithdrawalPreview }
  | { readonly status: "error"; readonly message: string };

type Outcome = Awaited<ReturnType<WithdrawFromSession>>;

const UNCONFIRMED_MESSAGE = "We couldn't confirm whether you withdrew. Try again: the same request is reused, so nothing happens twice.";

/**
 * UC2-05 Withdraw from Session: shows the server's refund preview before anything happens, asks
 * how the place is passed on (ADR-0006: open it to the waitlist, or invite one named person;
 * the choice cannot change later), then withdraws. After an unconfirmed result the same request
 * (key and choice) is kept and the choice is locked, so a retry can only replay it.
 */
export function WithdrawButton({ session, previewWithdrawal, withdraw, candidates, onWithdrawn }: {
  readonly session: JoinedSessionItem;
  readonly previewWithdrawal: PreviewWithdrawal;
  readonly withdraw: WithdrawFromSession;
  /** People the player may name as their replacement. */
  readonly candidates: readonly ReplacementCandidate[];
  /** Called when the player closes the dialog after withdrawing, to reload their sessions. */
  readonly onWithdrawn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [mode, setMode] = useState<Replacement["mode"] | null>(null);
  const [inviteeId, setInviteeId] = useState<string | null>(null);
  const [locked, setLocked] = useState<WithdrawRequest | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** The last request sent, so the result can name the invited person. */
  const [sent, setSent] = useState<WithdrawRequest | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function loadPreview() {
    setPreview({ status: "loading" });
    try {
      const result = await previewWithdrawal(session.sessionId);
      setPreview(result.status === "ready" ? result : { status: "error", message: result.message });
    } catch {
      setPreview({ status: "error", message: "We couldn't check your refund. Please try again." });
    }
  }

  function openDialog() {
    if (locked === null) setOutcome(null);
    setOpen(true);
    void loadPreview();
  }

  const currentMode = locked?.replacement.mode ?? mode;
  const currentInvitee = locked?.replacement.mode === "DIRECT_INVITE" ? locked.replacement.inviteeId : inviteeId;
  const replacement: Replacement | null = locked?.replacement
    ?? (mode === "OPEN_SLOT" ? { mode } : mode === "DIRECT_INVITE" && inviteeId !== null ? { mode, inviteeId } : null);

  async function confirm() {
    if (busy.current || replacement === null || preview.status !== "ready") return;
    busy.current = true;
    setPending(true);
    const request = locked ?? { sessionId: session.sessionId, idempotencyKey: crypto.randomUUID(), replacement };
    setSent(request);
    try {
      const result = await withdraw(request);
      setLocked(result.status === "error" && result.unconfirmed ? request : null);
      setOutcome(result);
    } catch {
      setLocked(request);
      setOutcome({ status: "error", code: "UNKNOWN_RESULT", message: UNCONFIRMED_MESSAGE, unconfirmed: true });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function close() {
    setOpen(false);
    if (outcome?.status === "withdrawn") onWithdrawn();
  }

  const withdrawn = outcome?.status === "withdrawn" ? outcome : null;
  const choiceLocked = locked !== null || pending;
  const name = (id: string) => candidates.find((candidate) => candidate.userId === id)?.displayName ?? "the person you invited";

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11" onClick={openDialog} aria-label={`Withdraw from ${session.sport} at ${session.venueName}`}>
        Withdraw
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!pending) { if (next) setOpen(true); else close(); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{withdrawn ? "You've withdrawn" : "Withdraw from this session?"}</DialogTitle>
            <DialogDescription>
              {session.sport} at {session.venueName}, <time dateTime={session.startAt}>{singaporeStart.format(new Date(session.startAt))}</time> (Singapore time).
            </DialogDescription>
          </DialogHeader>

          {withdrawn && (
            <p role="status">
              {withdrawn.kind === "REFUNDED"
                ? <><Money cents={withdrawn.refundedCents} className="font-semibold" /> is back in your wallet.</>
                : <>Your share stays held until {sent?.replacement.mode === "DIRECT_INVITE" ? `${name(sent.replacement.inviteeId)} accepts` : "someone takes your place"}. If nobody does before the session starts, it goes to the booker.</>}
            </p>
          )}

          {!withdrawn && preview.status === "loading" && <LoadingSpinner label="Checking your refund…" />}
          {!withdrawn && preview.status === "error" && (
            <div className="space-y-2">
              <ErrorMessage>{preview.message}</ErrorMessage>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadPreview()}>Try again</Button>
            </div>
          )}

          {!withdrawn && preview.status === "ready" && (
            <div className="space-y-4">
              {preview.preview.kind === "REFUNDED" ? (
                <div className="rounded-lg bg-secondary p-4 text-center">
                  <p className="text-sm text-muted-foreground">Back to your wallet now</p>
                  <Money cents={preview.preview.refundCents} className="text-3xl font-bold" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg bg-secondary p-4 text-center">
                    <p className="text-sm text-muted-foreground">Back to your wallet now</p>
                    <Money cents={preview.preview.refundCents} className="text-3xl font-bold" />
                  </div>
                  <InfoNote icon>
                    The session starts in 30 hours or less, so your <Money cents={preview.preview.heldCents} /> stays held until
                    someone takes your place. If nobody does before it starts, it goes to the booker.
                  </InfoNote>
                </div>
              )}

              <fieldset className="space-y-2" disabled={choiceLocked}>
                <legend className="mb-2 text-sm font-medium">Who gets your place?</legend>
                <ChoiceOption name={`withdraw-${session.sessionId}`} checked={currentMode === "OPEN_SLOT"} onChange={() => setMode("OPEN_SLOT")}
                  label="Open it to the waitlist" hint="The next eligible player in the queue gets it." />
                <ChoiceOption name={`withdraw-${session.sessionId}`} checked={currentMode === "DIRECT_INVITE"} onChange={() => setMode("DIRECT_INVITE")}
                  disabled={candidates.length === 0} label="Invite one person"
                  hint={candidates.length === 0 ? "There's no one you can invite yet." : "Only they can take it, once they accept."} />
                {currentMode === "DIRECT_INVITE" && (
                  <fieldset className="ml-6 space-y-2" disabled={choiceLocked}>
                    <legend className="sr-only">Person to invite</legend>
                    {candidates.map((candidate) => (
                      <label key={candidate.userId} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed">
                        <input type="radio" name={`invitee-${session.sessionId}`} className="h-4 w-4"
                          checked={currentInvitee === candidate.userId}
                          onChange={() => setInviteeId(candidate.userId)} />
                        <span className="min-w-0 break-words">{candidate.displayName}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </fieldset>
              <InfoNote icon>You can&apos;t change this choice after withdrawing.</InfoNote>
            </div>
          )}

          {outcome?.status === "error" && <ErrorMessage>{outcome.message}</ErrorMessage>}

          <DialogFooter className="gap-2 sm:gap-0">
            {withdrawn ? (
              <Button type="button" className="min-h-11" onClick={close}>Done</Button>
            ) : (
              <>
                <Button type="button" variant="outline" className="min-h-11" disabled={pending} onClick={close}>Keep my place</Button>
                <Button type="button" variant="destructive" className="min-h-11" disabled={pending || replacement === null || preview.status !== "ready"} onClick={() => void confirm()}>
                  {pending ? "Withdrawing…" : locked ? "Retry withdrawal" : "Withdraw"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChoiceOption({ name, checked, onChange, label, hint, disabled = false }: {
  readonly name: string; readonly checked: boolean; readonly onChange: () => void;
  readonly label: string; readonly hint: string; readonly disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
      <input type="radio" name={name} className="mt-1 h-4 w-4" checked={checked} onChange={onChange} disabled={disabled} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
