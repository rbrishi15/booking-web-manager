"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SPORTS } from "@/app/(auth)/schemas";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sportImage } from "@/lib/sessions/sport-image";
import { DateTimeEditor } from "./date-time-editor";
import { VenuePicker } from "./venue-picker";
import { decimalCents, draftFromSubmission, draftPricing, emptySessionDraft, parseSgdCents, pendingStorageKey, pendingSubmissionSchema,
  submissionPayload, updateDraft, validateStep, type FieldErrors, type PendingSubmission, type SessionDraft } from "./model";
import type { CreateSession, CreationOutcome, SearchVenues } from "./transport";

export interface CreateSessionWizardProps {
  readonly userId: string; readonly create: CreateSession; readonly search: SearchVenues; readonly onCreated: () => void;
  readonly initialDraft?: SessionDraft; readonly initialStep?: 1 | 2 | 3;
  readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}
const headings = ["Booked Venue Details", "Booked Venue Settings", "Auto-Generated Pricing"];
const descriptions = ["Tell us where and when you want to play.", "Set access, group size, and player reliability preferences.", "A suggested price based on your booking cost and number of slots."];

export function CreateSessionWizard({ userId, create, search, onCreated, initialDraft = emptySessionDraft, initialStep = 1, storage }: CreateSessionWizardProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [step, setStep] = useState<number>(initialStep);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<PendingSubmission | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [failure, setFailure] = useState<Extract<CreationOutcome, { status: "error" }> | null>(null);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const failureMessage = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const key = pendingStorageKey(userId);
  const getStorage = () => storage ?? window.sessionStorage;

  useEffect(() => {
    try {
      const value = (storage ?? window.sessionStorage).getItem(key);
      if (value) {
        const saved = pendingSubmissionSchema.parse(JSON.parse(value));
        setDraft(draftFromSubmission(saved.payload)); setPending(saved); setStep(3);
        setFailure({ status: "error", code: "PENDING_SUBMISSION", ambiguous: true, message: "A submission is awaiting confirmation. Retry it to safely recover the result." });
      }
      setReady(true);
    } catch {
      setFailure({ status: "error", code: "STORAGE_UNAVAILABLE", ambiguous: false,
        message: "We couldn't read your pending submission. Enable session storage and reload before creating a session." });
    }
  }, [key, storage]);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
    if (body.current) body.current.scrollTop = 0;
  }, [step]);
  useEffect(() => { if (failure) failureMessage.current?.focus(); }, [failure]);
  const locked = submitting || completed || !!pending || !ready;
  const range = draftPricing(draft);
  const price = parseSgdCents(draft.price);
  function change(patch: Partial<SessionDraft>) {
    if (locked) return;
    setDraft((value) => updateDraft(value, patch)); setErrors({}); setFailure(null);
  }
  function showErrors(found: FieldErrors) {
    setErrors(found);
    const field = Object.keys(found)[0];
    requestAnimationFrame(() => document.getElementById(field ?? "")?.focus());
  }
  async function submit() {
    if (inFlight.current || completed || !ready) return;
    const replaying = pending !== null;
    let saved = pending;
    if (!saved) {
      for (const part of [1, 2, 3]) {
        const found = validateStep(draft, part);
        if (Object.keys(found).length) { setStep(part); showErrors(found); return; }
      }
      saved = { version: 1, payload: submissionPayload(draft, crypto.randomUUID()) };
      try { getStorage().setItem(key, JSON.stringify(saved)); } catch {
        setFailure({ status: "error", code: "STORAGE_UNAVAILABLE", ambiguous: false, message: "Enable session storage so your submission can be retried safely." }); return;
      }
      setPending(saved);
    }
    inFlight.current = true; setSubmitting(true); setFailure(null);
    try {
      const result = await create(saved.payload);
      if (result.status === "created") {
        getStorage().removeItem(key); setPending(null); setCompleted(true); onCreated();
      } else {
        // Authentication or service rejection of a replay cannot resolve an earlier ambiguous result.
        if (!result.ambiguous && !replaying) { getStorage().removeItem(key); setPending(null); }
        setFailure(result);
      }
    } catch {
      setFailure({ status: "error", code: "UNKNOWN_RESULT", ambiguous: true,
        message: "We couldn't confirm the result. Retry this submission to check safely." });
    } finally { inFlight.current = false; setSubmitting(false); }
  }
  function advance() {
    const found = validateStep(draft, step);
    if (Object.keys(found).length) { showErrors(found); return; }
    setErrors({}); setStep((value) => value + 1);
  }
  return <section aria-label="Create a session" className="mx-auto flex h-[100svh] w-full flex-col overflow-hidden bg-card md:my-8 md:h-[calc(100svh-4rem)] md:max-w-xl md:rounded-xl md:border md:shadow-sm">
    <header className="shrink-0 bg-foreground px-6 pb-7 pt-5 text-background md:px-8">
      <div className="mb-8 flex items-center gap-5">
        {step === 1 ? <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-background hover:bg-background/10 hover:text-background" aria-label="Back to hosted sessions"><Link href="/sessions"><ArrowLeft aria-hidden="true" className="h-5 w-5" /></Link></Button>
          : <Button type="button" variant="ghost" size="icon" aria-label="Previous step" disabled={locked} className="h-11 w-11 shrink-0 text-background hover:bg-background/10 hover:text-background" onClick={() => { setErrors({}); setStep((value) => value - 1); }}><ArrowLeft aria-hidden="true" className="h-5 w-5" /></Button>}
        <div role="progressbar" aria-label="Creation progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} className="h-0.5 flex-1 bg-background/30"><div className="h-full bg-background" style={{ width: `${step / 3 * 100}%` }} /></div>
        <span className="text-xs font-semibold tabular-nums">0{step} / 03</span>
      </div>
      <h1 ref={heading} tabIndex={-1} className="max-w-72 text-3xl font-bold leading-tight tracking-tight outline-none">{headings[step - 1]}</h1>
      <p className="mt-3 max-w-72 text-sm leading-relaxed text-background/80">{descriptions[step - 1]}</p>
    </header>
    <div ref={body} role="region" aria-label="Session form" tabIndex={0}
      onFocusCapture={(event) => { if (event.target !== event.currentTarget && event.currentTarget.contains(event.target)) event.target.scrollIntoView({ block: "nearest" }); }}
      className="min-h-0 flex-1 scroll-py-6 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
    {step === 3 && <div className="relative aspect-[3/2] w-full overflow-hidden md:aspect-[2/1]"><Image src={sportImage(draft.sport)} alt="" fill priority sizes="(max-width: 767px) 100vw, 576px" className="object-cover" /></div>}
    <div className="space-y-5 px-6 py-7 md:px-8">
      {step === 1 && <>
        <div className="space-y-2"><label htmlFor="sport" className="text-xs font-semibold">Sport</label>
          <Select value={draft.sport} disabled={locked} onValueChange={(sport) => change({ sport })}>
            <SelectTrigger id="sport" className="min-h-11"><SelectValue /></SelectTrigger><SelectContent>{SPORTS.map((sport) => <SelectItem key={sport} value={sport}>{sport}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <VenuePicker draft={draft} errors={errors} disabled={locked} onChange={change} search={search} />
        <DateTimeEditor draft={draft} disabled={locked} error={errors.dateTime} onChange={change} />
        <div className="space-y-2"><label htmlFor="cost" className="text-xs font-semibold">Booking cost (SGD)</label>
          <Input id="cost" inputMode="decimal" placeholder="0.00" value={draft.cost} disabled={locked} className="min-h-11" aria-invalid={!!errors.cost} aria-describedby="cost-error" onChange={(event) => change({ cost: event.target.value })} />
          <p id="cost-error" role={errors.cost ? "alert" : undefined} className="text-xs text-destructive">{errors.cost}</p>
        </div>
      </>}
      {step === 2 && <>
        <div className="space-y-2"><label htmlFor="visibility" className="text-xs font-semibold">Room Visibility</label>
          <Select value={draft.visibility} disabled={locked} onValueChange={(visibility: "PRIVATE" | "PUBLIC") => change({ visibility })}>
            <SelectTrigger id="visibility" className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PRIVATE">Private</SelectItem><SelectItem value="PUBLIC">Public</SelectItem></SelectContent>
          </Select><p className="text-xs text-muted-foreground">{draft.visibility === "PRIVATE" ? "Only people with your room link can join." : "People can find this session in Discover."}</p>
        </div>
        <Stepper id="totalSlots" label="No. of Slots" value={draft.totalSlots} min={2} max={8} disabled={locked} onChange={(totalSlots) => change({ totalSlots })} />
        <div className="space-y-2"><label htmlFor="reliability" className="text-xs font-semibold">Minimum Reliability Score</label>
          <Select value={draft.reliability} disabled={locked} onValueChange={(reliability) => change({ reliability })}>
            <SelectTrigger id="reliability" className="min-h-11"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="none">No minimum</SelectItem>{[60, 70, 80, 90, 100].map((score) => <SelectItem key={score} value={String(score)}>{(score / 20).toFixed(1)} / 5.0</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </>}
      {step === 3 && <>
        <div><p className="text-xs font-semibold">Price per slot</p><p className="mt-2 text-5xl font-semibold tracking-tight"><Money cents={price ?? 0} /></p>
          {range && <p className="mt-2 text-xs text-muted-foreground">Suggested <Money cents={range.suggestedCents} /> · based on booking cost and {draft.totalSlots} slots</p>}
        </div>
        <div><p className="text-xs">Estimated revenue at full capacity ({draft.totalSlots} slots)</p><p role="status" className="mt-2 text-2xl font-semibold text-success"><Money cents={range && price !== undefined && price <= range.maximumCents ? price * draft.totalSlots : 0} /></p></div>
        {range && <div className="space-y-3">
          <label htmlFor="price" className="block text-xs font-semibold">Adjust price per slot (SGD)</label>
          <Input id="price" inputMode="decimal" value={draft.price} disabled={locked} aria-invalid={!!errors.price} aria-describedby="price-error price-range" className="min-h-11" onChange={(event) => change({ price: event.target.value })} />
          <input aria-label="Price per slot slider" type="range" min={range.minimumCents} max={range.maximumCents} step={1} value={price ?? range.suggestedCents} disabled={locked}
            onChange={(event) => change({ price: decimalCents(Number(event.target.value)) })}
            onKeyDown={(event) => {
              const current = price ?? range.suggestedCents;
              const target = event.key === "Home" ? range.minimumCents : event.key === "End" ? range.maximumCents
                : ["ArrowRight", "ArrowUp"].includes(event.key) ? current + 1 : ["ArrowLeft", "ArrowDown"].includes(event.key) ? current - 1 : undefined;
              if (target !== undefined) { event.preventDefault(); change({ price: decimalCents(Math.max(range.minimumCents, Math.min(range.maximumCents, target))) }); }
            }} className="min-h-11 w-full accent-foreground" />
          <p id="price-range" className="flex justify-between text-xs text-muted-foreground"><Money cents={range.minimumCents} /><Money cents={range.maximumCents} /></p>
          <p id="price-error" role={errors.price ? "alert" : undefined} className="text-xs text-destructive">{errors.price}</p>
        </div>}
      </>}
      {failure && <div ref={failureMessage} tabIndex={-1} className="space-y-2 outline-none"><ErrorMessage>{failure.message}</ErrorMessage>
        {pending && <p className="text-xs leading-relaxed text-muted-foreground">Your submitted details are saved. Editing is paused until this submission is resolved.</p>}
        {failure.code === "UNAUTHENTICATED" && <Button asChild variant="link"><Link href="/login?next=%2Fsessions%2Fcreate">Sign in again</Link></Button>}
        {failure.code === "EMAIL_VERIFICATION_REQUIRED" && <Button asChild variant="link"><Link href="/profile/email">Verify email</Link></Button>}
      </div>}
    </div>
    </div>
    <footer className="flex shrink-0 gap-6 border-t bg-card px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 md:px-8">
      {step > 1 && <Button type="button" variant="outline" className="min-h-12 flex-1" disabled={locked} onClick={() => { setErrors({}); setStep((value) => value - 1); }}>Back</Button>}
      <Button type="button" className="min-h-12 flex-1" disabled={submitting || completed || !ready} onClick={step === 3 ? () => void submit() : advance}>
        {step === 3 ? submitting ? "Creating…" : pending ? "Retry submission" : "Done" : <>Next<ArrowRight aria-hidden="true" className="ml-auto h-5 w-5" /></>}
      </Button>
    </footer>
  </section>;
}

function Stepper({ id, label, value, min, max, disabled, onChange }: {
  readonly id: string; readonly label: string; readonly value: number; readonly min: number; readonly max: number; readonly disabled: boolean; readonly onChange: (value: number) => void;
}) {
  return <div className="space-y-2"><span id={`${id}-label`} className="text-xs font-semibold">{label}</span>
    <div id={id} role="group" aria-labelledby={`${id}-label`} className="flex items-center justify-between rounded-md border">
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}><Minus className="h-4 w-4" aria-hidden="true" /></Button>
      <output aria-live="polite" className="text-sm tabular-nums">{value}</output>
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><Plus className="h-4 w-4" aria-hidden="true" /></Button>
    </div>
  </div>;
}
