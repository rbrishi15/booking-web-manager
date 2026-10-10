"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import type { WithdrawalState } from "../use-withdrawal-flow";
import type { Replacement, ReplacementCandidate, WithdrawalPreview } from "../withdrawal-ports";
import { singaporeStart } from "./joined-session-format";

export interface WithdrawalDialogProps {
  readonly state: WithdrawalState;
  /** People the player may name as their replacement. */
  readonly candidates: readonly ReplacementCandidate[];
  readonly onChooseMode: (mode: Replacement["mode"]) => void;
  readonly onChooseInvitee: (inviteeId: string) => void;
  readonly onConfirm: () => void;
  readonly onRetryPreview: () => void;
  readonly onClose: () => void;
}

/**
 * UC2-05 Withdraw from Session, display only: one controlled dialog for the whole list, driven by
 * `useWithdrawalFlow`. Shows the server's refund before anything happens, then how the place is
 * passed on (ADR-0006: open it to the waitlist, or invite one named person; unchangeable).
 */
export function WithdrawalDialog({ state, candidates, onChooseMode, onChooseInvitee, onConfirm, onRetryPreview, onClose }: WithdrawalDialogProps) {
  if (state.step === "closed") return <Dialog open={false} />;
  const { session } = state;
  const submitting = (state.step === "choosing" || state.step === "unconfirmed") && state.submitting;
  const name = (id: string) => candidates.find((candidate) => candidate.userId === id)?.displayName ?? "the person you invited";

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.step === "withdrawn" ? "You've withdrawn" : "Withdraw from this session?"}</DialogTitle>
          <DialogDescription>
            {session.sport} at {session.venueName}, <time dateTime={session.startAt}>{singaporeStart.format(new Date(session.startAt))}</time> (Singapore time).
          </DialogDescription>
        </DialogHeader>

        {state.step === "loading" && <LoadingSpinner label="Checking your refund…" />}

        {state.step === "preview-failed" && (
          <div className="space-y-2">
            <ErrorMessage>{state.message}</ErrorMessage>
            <Button type="button" variant="outline" className="min-h-11" onClick={onRetryPreview}>Try again</Button>
          </div>
        )}

        {state.step === "choosing" && (
          <div className="space-y-4">
            {state.termsChanged && (
              <ErrorMessage>
                Your refund changed while this was open: the session now starts in 30 hours or less. Check the new amount and confirm again.
              </ErrorMessage>
            )}
            <Refund preview={state.preview} />
            <fieldset className="space-y-2" disabled={state.submitting}>
              <legend className="mb-2 text-sm font-medium">Who gets your place?</legend>
              <ChoiceOption name="withdraw-mode" checked={state.mode === "OPEN_SLOT"} onChange={() => onChooseMode("OPEN_SLOT")}
                label="Open it to the waitlist" hint="The next eligible player in the queue gets it." />
              <ChoiceOption name="withdraw-mode" checked={state.mode === "DIRECT_INVITE"} onChange={() => onChooseMode("DIRECT_INVITE")}
                disabled={candidates.length === 0} label="Invite one person"
                hint={candidates.length === 0 ? "There's no one you can invite yet." : "Only they can take it, once they accept."} />
              {state.mode === "DIRECT_INVITE" && (
                <fieldset className="ml-6 space-y-2">
                  <legend className="sr-only">Person to invite</legend>
                  {candidates.map((candidate) => (
                    <label key={candidate.userId} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:cursor-not-allowed">
                      <input type="radio" name="withdraw-invitee" className="h-4 w-4" checked={state.inviteeId === candidate.userId}
                        onChange={() => onChooseInvitee(candidate.userId)} />
                      <span className="min-w-0 break-words">{candidate.displayName}</span>
                    </label>
                  ))}
                </fieldset>
              )}
            </fieldset>
            <InfoNote icon>You can&apos;t change this choice after withdrawing.</InfoNote>
            {state.error !== null && <ErrorMessage>{state.error}</ErrorMessage>}
          </div>
        )}

        {state.step === "unconfirmed" && (
          <div className="space-y-3">
            <ErrorMessage>{state.message}</ErrorMessage>
            <p className="text-sm text-muted-foreground">
              Retrying sends the same request:{" "}
              {state.request.replacement.mode === "OPEN_SLOT" ? "your place opens to the waitlist" : `${name(state.request.replacement.inviteeId)} is invited to take your place`}.
            </p>
          </div>
        )}

        {state.step === "withdrawn" && (
          <div className="space-y-3">
            <p role="status">
              {state.result.kind === "REFUNDED"
                ? <><Money cents={state.result.refundedCents} className="font-semibold" /> is back in your wallet.</>
                : <>Your share stays held until {state.request.replacement.mode === "DIRECT_INVITE" ? `${name(state.request.replacement.inviteeId)} accepts` : "someone takes your place"}. If nobody does before the session starts, it goes to the booker.</>}
            </p>
            {state.result.kind !== state.preview.kind && (
              <InfoNote icon>The 30-hour cutoff passed while you were confirming, so the late-withdrawal rule applied.</InfoNote>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {state.step === "withdrawn" ? (
            <Button type="button" className="min-h-11" onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button type="button" variant="outline" className="min-h-11" disabled={submitting} onClick={onClose}>Keep my place</Button>
              {state.step === "unconfirmed" ? (
                <Button type="button" variant="destructive" className="min-h-11" disabled={submitting} onClick={onConfirm}>
                  {submitting ? "Withdrawing…" : "Retry withdrawal"}
                </Button>
              ) : (
                <Button type="button" variant="destructive" className="min-h-11" onClick={onConfirm}
                  disabled={state.step !== "choosing" || state.submitting || state.mode === null || (state.mode === "DIRECT_INVITE" && state.inviteeId === null)}>
                  {submitting ? "Withdrawing…" : state.step === "choosing" && state.termsChanged ? "Withdraw with new terms" : "Withdraw"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Refund({ preview }: { readonly preview: WithdrawalPreview }) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-secondary p-4 text-center">
        <p className="text-sm text-muted-foreground">Back to your wallet now</p>
        <Money cents={preview.refundCents} className="text-3xl font-bold" />
      </div>
      {preview.kind === "AWAITING_REPLACEMENT" && (
        <InfoNote icon>
          The session starts in 30 hours or less, so your <Money cents={preview.heldCents} /> stays held until someone
          takes your place. If nobody does before it starts, it goes to the booker.
        </InfoNote>
      )}
      <p className="text-xs text-muted-foreground">The refund is checked again just before you withdraw; the server&apos;s result is final.</p>
    </div>
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
