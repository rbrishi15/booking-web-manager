"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { normalizeUserHandle, userHandleProblem } from "@/app/users/schemas";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorMessage } from "@/components/ui/error-message";
import { InfoNote } from "@/components/ui/info-note";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import type { ReplacementSearchState } from "../use-replacement-search";
import type { WithdrawalState } from "../use-withdrawal-flow";
import type { Replacement, WithdrawalPreview } from "../withdrawal-ports";
import { singaporeStart } from "./joined-session-format";

export interface WithdrawalDialogProps {
  readonly state: WithdrawalState;
  /** Finding the person to name by their user ID (ADR-0021); the found player becomes the invitee. */
  readonly inviteSearch: ReplacementSearchState;
  readonly onSearchInvitee: (handle: string) => void;
  readonly onChooseMode: (mode: Replacement["mode"]) => void;
  readonly onConfirm: () => void;
  readonly onRetryPreview: () => void;
  readonly onClose: () => void;
  readonly onRestoreFocus?: () => void;
}

/**
 * UC2-05 Withdraw from Session, display only: one controlled dialog for the whole list, driven by
 * `useWithdrawalFlow`. Shows the server's refund before anything happens, then what happens to the
 * place (ADR-0006: open it to the waitlist, or invite one named person, found by their user ID;
 * ADR-0024: when late, forfeit the share and close the place; unchangeable).
 */
export function WithdrawalDialog({ state, inviteSearch, onSearchInvitee, onChooseMode, onConfirm, onRetryPreview, onClose, onRestoreFocus }: WithdrawalDialogProps) {
  if (state.step === "closed") return <Dialog open={false} />;
  const { session } = state;
  const submitting = (state.step === "choosing" || state.step === "unconfirmed") && state.submitting;
  const name = (id: string) =>
    inviteSearch.status === "found" && inviteSearch.candidate.userId === id ? inviteSearch.candidate.displayName : "the person you invited";

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" onCloseAutoFocus={onRestoreFocus ? (event) => { event.preventDefault(); onRestoreFocus(); } : undefined}>
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
                Your refund changed while this was open: the session now starts in less than 30 hours. You can invite one person or forfeit your share. Check the new amount and confirm again.
              </ErrorMessage>
            )}
            <Refund preview={state.preview} forfeiting={state.mode === "FORFEIT"} />
            <fieldset className="space-y-2" disabled={state.submitting}>
              <legend className="mb-2 text-sm font-medium">What happens to your place?</legend>
              {state.preview.kind === "REFUNDED" && (
                <ChoiceOption name="withdraw-mode" checked={state.mode === "OPEN_SLOT"} onChange={() => onChooseMode("OPEN_SLOT")}
                  label="Open it to the waitlist" hint="The next eligible player in the queue gets it." />
              )}
              <ChoiceOption name="withdraw-mode" checked={state.mode === "DIRECT_INVITE"} onChange={() => onChooseMode("DIRECT_INVITE")}
                label="Invite one person" hint="Find them by their user ID. Only they can take it, once they accept." />
              {state.mode === "DIRECT_INVITE" && (
                <InviteeSearch search={inviteSearch} chosen={state.inviteeId !== null} onSearch={onSearchInvitee} />
              )}
              {/* Forfeiting only matters when the share would stay held; earlier withdrawals are refunded in full. */}
              {state.preview.kind === "AWAITING_REPLACEMENT" && (
                <ChoiceOption name="withdraw-mode" checked={state.mode === "FORFEIT"} onChange={() => onChooseMode("FORFEIT")}
                  label="Forfeit my share" hint="Your share goes to the booker and your place closes, so nobody else can take it." />
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
              This request is kept, even if you close this or reload the page, until we know what happened. Retrying sends the same request:{" "}
              {state.request.replacement.mode === "OPEN_SLOT" ? "your place opens to the waitlist"
                : state.request.replacement.mode === "FORFEIT" ? "your share goes to the booker and your place closes"
                : `${name(state.request.replacement.inviteeId)} is invited to take your place`}.
            </p>
          </div>
        )}

        {state.step === "withdrawn" && (
          <div className="space-y-3">
            <p role="status">
              {state.result.kind === "REFUNDED"
                ? <><Money cents={state.result.refundedCents} className="font-semibold" /> is back in your wallet.</>
                : state.result.kind === "FORFEITURE_DUE"
                ? <>Your <Money cents={state.preview.heldCents} className="font-semibold" /> goes to the booker, and your place is closed.</>
                : <>Your share stays held until {state.request.replacement.mode === "DIRECT_INVITE" ? `${name(state.request.replacement.inviteeId)} accepts` : "someone takes your place"}. If nobody does before the session starts, it goes to the booker.</>}
            </p>
            {state.result.kind !== "REFUNDED" && state.preview.kind === "REFUNDED" && (
              <InfoNote icon>The 30-hour cutoff passed while you were confirming, so the late-withdrawal rule applied.</InfoNote>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {state.step === "withdrawn" ? (
            <Button type="button" className="min-h-11" onClick={onClose}>Done</Button>
          ) : (
            <>
              {/* After an unresolved request the place may already be withdrawn, so don't promise to keep it. */}
              <Button type="button" variant="outline" className="min-h-11" disabled={submitting} onClick={onClose}>
                {state.step === "unconfirmed" ? "Retry later" : "Keep my place"}
              </Button>
              {state.step === "unconfirmed" ? (
                <Button type="button" variant="destructive" className="min-h-11" disabled={submitting} onClick={onConfirm}>
                  {submitting ? "Withdrawing…" : "Retry withdrawal"}
                </Button>
              ) : (
                <Button type="button" variant="destructive" className="min-h-11" onClick={onConfirm}
                  disabled={state.step !== "choosing" || state.submitting || state.mode === null || (state.mode === "DIRECT_INVITE" && state.inviteeId === null)}>
                  {submitting ? "Withdrawing…" : state.step === "choosing" && state.mode === "FORFEIT" ? "Forfeit and withdraw"
                    : state.step === "choosing" && state.termsChanged ? "Withdraw with new terms" : "Withdraw"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Finds the person to name by exact user ID, the same way as Find a player on the Groups page. */
function InviteeSearch({ search, chosen, onSearch }: {
  readonly search: ReplacementSearchState;
  /** The found player is the withdrawal's invitee. */
  readonly chosen: boolean;
  readonly onSearch: (handle: string) => void;
}) {
  const [handle, setHandle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  // Check the ID's form here, so a typo never waits for the server.
  function find() {
    if (search.status === "searching") return;
    const normalized = normalizeUserHandle(handle);
    const issue = userHandleProblem(normalized);
    setProblem(issue);
    if (issue === null) onSearch(normalized);
  }

  const message = problem ?? (search.status === "not-found" ? `No player has the user ID @${search.handle}.`
    : search.status === "self" ? "That's your own user ID. Enter the user ID of the person you want to invite."
    : search.status === "error" ? search.message : null);

  return (
    <div className="ml-6 space-y-2">
      <Label htmlFor="withdraw-invitee-handle">Their user ID</Label>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1 basis-40">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
          <Input
            id="withdraw-invitee-handle"
            value={handle}
            // The "@" is already shown in front of the field.
            onChange={(event) => setHandle(event.target.value.replace(/^\s*@+/u, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                find();
              }
            }}
            placeholder="user_id"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={33}
            className="min-h-11 pl-8"
            aria-invalid={message !== null}
            aria-describedby="withdraw-invitee-result"
          />
        </div>
        <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={find} disabled={search.status === "searching"}>
          <Search className="h-4 w-4" aria-hidden="true" focusable="false" />
          {search.status === "searching" ? "Finding…" : "Find"}
        </Button>
      </div>
      <div id="withdraw-invitee-result" aria-live="polite" className="text-sm">
        {message !== null && <p className="text-destructive">{message}</p>}
        {problem === null && search.status === "found" && chosen && (
          <p className="rounded-md border border-primary bg-accent px-3 py-2">
            <span className="font-medium">{search.candidate.displayName}</span>{" "}
            <span className="break-all text-muted-foreground">@{search.candidate.handle}</span> will be invited to take your place.
          </p>
        )}
      </div>
    </div>
  );
}

function Refund({ preview, forfeiting }: { readonly preview: WithdrawalPreview; readonly forfeiting: boolean }) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-secondary p-4 text-center">
        <p className="text-sm text-muted-foreground">Back to your wallet now</p>
        <Money cents={preview.refundCents} className="text-3xl font-bold" />
      </div>
      {preview.kind === "AWAITING_REPLACEMENT" && (forfeiting ? (
        <InfoNote icon>
          Your <Money cents={preview.heldCents} /> goes to the booker and won&apos;t come back to you, even if the
          session fills.
        </InfoNote>
      ) : (
        <InfoNote icon>
          The session starts in less than 30 hours, so your <Money cents={preview.heldCents} /> stays held until someone
          you invite accepts your place. You can invite one person or forfeit your share; the waitlist is closed.
          If your invitee doesn&apos;t accept before it starts, your share goes to the booker.
        </InfoNote>
      ))}
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
