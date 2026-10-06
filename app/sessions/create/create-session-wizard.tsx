"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { SPORTS } from "@/app/(auth)/schemas";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sportImage } from "@/lib/sessions/sport-image";
import { DateTimeEditor } from "./date-time-editor";
import { VenuePicker } from "./venue-picker";
import { createSessionStore } from "./create-session-store";
import { connectSessionDevtools } from "./create-session-devtools";
import { decimalCents, draftPricing, parseSgdCents, type FieldErrors, type SessionDraft } from "./model";
import type { CreateSession, SearchVenues } from "./transport";

export interface CreateSessionWizardProps {
  readonly userId: string; readonly create: CreateSession; readonly search: SearchVenues; readonly onCreated: () => void;
  readonly initialDraft?: SessionDraft; readonly initialStep?: 1 | 2 | 3;
  readonly storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}
const headings = ["Booked Venue Details", "Booked Venue Settings", "Auto-Generated Pricing"];
const descriptions = ["Tell us where and when you want to play.", "Set access, group size, and player reliability preferences.", "A suggested price based on your booking cost and number of slots."];

const noErrors: FieldErrors = {};

export function CreateSessionWizard(props: CreateSessionWizardProps) {
  return <SessionWizard key={props.userId} {...props} />;
}

function SessionWizard(props: CreateSessionWizardProps) {
  const { userId, create, search, onCreated, initialDraft, initialStep, storage } = props;
  const [store] = useState(() => createSessionStore({
    userId, initialDraft, initialStep, getStorage: () => storage ?? window.sessionStorage,
  }));
  const draft = useStore(store, (state) => state.draft);
  const step = useStore(store, (state) => state.step);
  const workflow = useStore(store, (state) => state.workflow);
  const { change, advance, back, restartAfterRecovery } = store.getState();
  const mounted = useRef(false);
  // Connect external debugging only after commit, and ignore late navigation
  // after unmount. State transitions live in the store.
  useEffect(() => {
    mounted.current = true;
    const disconnectDevtools = connectSessionDevtools(store);
    return () => { mounted.current = false; disconnectDevtools(); };
  }, [store]);
  const body = useRef<HTMLDivElement>(null);
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    if (!node) return;
    node.focus();
    if (body.current) body.current.scrollTop = 0;
  }, []);
  const focusFailure = useCallback((node: HTMLDivElement | null) => { node?.focus(); }, []);
  const errors = workflow.status === "editing" ? workflow.errors : noErrors;
  const failure = "failure" in workflow ? workflow.failure : null;
  const pending = "pending" in workflow ? workflow.pending : null;
  const submitting = workflow.status === "submitting";
  const completed = workflow.status === "completed";
  const recoveryRequired = workflow.status === "recoveryRequired";
  const locked = workflow.status !== "editing";
  const range = draftPricing(draft);
  const price = parseSgdCents(draft.price);
  function showErrors(found: FieldErrors) {
    const field = Object.keys(found)[0];
    if (field) requestAnimationFrame(() => {
      if (mounted.current) body.current?.querySelector<HTMLElement>(`[id="${field}"]`)?.focus();
    });
  }
  async function submit() {
    const result = await store.getState().submit(create);
    if (!mounted.current) return;
    if (result.status === "invalid") showErrors(result.errors);
    // Navigation failures must never turn a confirmed creation into an unknown result.
    if (result.status === "created") onCreated();
  }
  function next() {
    const found = advance();
    if (found) showErrors(found);
  }
  return <section aria-label="Create a session" className="mx-auto flex h-[100svh] w-full flex-col overflow-hidden bg-card md:my-8 md:h-[calc(100svh-4rem)] md:max-w-xl md:rounded-xl md:border md:shadow-sm">
    <header className="shrink-0 bg-foreground px-6 pb-7 pt-5 text-background md:px-8">
      <div className="mb-8 flex items-center gap-5">
        {step === 1 ? <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-background hover:bg-background/10 hover:text-background" aria-label="Back to hosted sessions"><Link href="/sessions"><ArrowLeft aria-hidden="true" className="h-5 w-5" /></Link></Button>
          : <Button type="button" variant="ghost" size="icon" aria-label="Previous step" disabled={locked} className="h-11 w-11 shrink-0 text-background hover:bg-background/10 hover:text-background" onClick={back}><ArrowLeft aria-hidden="true" className="h-5 w-5" /></Button>}
        <div role="progressbar" aria-label="Creation progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} className="h-0.5 flex-1 bg-background/30"><div className="h-full bg-background" style={{ width: `${step / 3 * 100}%` }} /></div>
        <span className="text-xs font-semibold tabular-nums">0{step} / 03</span>
      </div>
      <h1 key={step} ref={focusHeading} tabIndex={-1} className="max-w-72 text-3xl font-bold leading-tight tracking-tight outline-none">{headings[step - 1]}</h1>
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
        <Stepper id="minimumHeadcount" label="Minimum viable headcount" value={draft.minimumHeadcount} min={2} max={draft.totalSlots} disabled={locked} onChange={(minimumHeadcount) => change({ minimumHeadcount })} />
        {errors.minimumHeadcount && <p role="alert" className="text-xs text-destructive">{errors.minimumHeadcount}</p>}
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
      {failure && <div key={`${failure.code}:${failure.message}`} ref={focusFailure} tabIndex={-1} className="space-y-2 outline-none"><ErrorMessage>{failure.message}</ErrorMessage>
        {recoveryRequired && <>
          <Button asChild variant="link"><Link href="/sessions" target="_blank" rel="noopener noreferrer">Check hosted sessions (new tab)</Link></Button>
          <p className="text-xs leading-relaxed text-muted-foreground">Starting again keeps a backup of the saved details. Only continue if you have confirmed the session was not created.</p>
          <Button type="button" variant="outline" onClick={restartAfterRecovery}>I checked my sessions; start again</Button>
        </>}
        {pending && <p className="text-xs leading-relaxed text-muted-foreground">Your submitted details are saved. Editing is paused until this submission is resolved.</p>}
        {failure.code === "UNAUTHENTICATED" && <Button asChild variant="link"><Link href="/login?next=%2Fsessions%2Fcreate">Sign in again</Link></Button>}
      </div>}
    </div>
    </div>
    <footer className="flex shrink-0 gap-6 border-t bg-card px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 md:px-8">
      {step > 1 && <Button type="button" variant="outline" className="min-h-12 flex-1" disabled={locked} onClick={back}>Back</Button>}
      <Button type="button" className="min-h-12 flex-1" disabled={submitting || completed || recoveryRequired} onClick={step === 3 ? () => void submit() : next}>
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
