"use client";

import { ArrowLeft, CalendarDays, CircleDot, Clock3, Feather, Grid2X2, MapPin, Search, SlidersHorizontal, Users, Volleyball } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useId } from "react";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
import { JoinSessionButton } from "@/app/commit/_components/join-session-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import { sportImage } from "@/lib/sessions/sport-image";
import { cn } from "@/lib/utils";
import type { DiscoveryPage } from "../contracts";
import type { DiscoveryFieldErrors, DiscoveryFilters } from "../query";
import type { DiscoveryState, FilterPanelState } from "./discovery-state";

export interface DiscoverySearchViewProps {
  readonly filters: DiscoveryFilters;
  readonly state: DiscoveryState;
  readonly filterPanel: FilterPanelState;
  readonly onToggleFilters: () => void;
  readonly onApply: (formData: FormData) => void;
  readonly onEdit: () => void;
  readonly onClear: () => void;
  readonly onNext: (cursor: string) => void;
  readonly onRetry: () => void;
  /** Already validated by the navigation controller; this destination never reaches the API. */
  readonly returnTo?: string;
}

const selectClassName = "flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:text-sm";
const sportChoices = ["Tennis", ...SPORTS.filter((sport) => sport !== "Tennis")];

/** Pure presentation: applied filters arrive from the URL; draft fields stay in the mounted form. */
export function DiscoverySearchView({ filters, state, filterPanel, onToggleFilters, onApply, onEdit, onClear, onNext, onRetry, returnTo = "/" }: DiscoverySearchViewProps) {
  const id = useId();
  const busy = state.status === "loading";
  const errors: DiscoveryFieldErrors = state.status === "invalid" ? state.fieldErrors : {};
  const expanded = filterPanel === "expanded";

  return (
    <div className="relative isolate mx-auto min-h-full w-full max-w-4xl px-6 pb-10 pt-4 md:my-5 md:px-10 md:pb-12 md:pt-5">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[270px] overflow-hidden md:h-[310px] md:rounded-2xl" aria-hidden="true">
        <Image src="/images/mobile-hero.png" alt="" fill sizes="(max-width: 767px) 100vw, 896px" priority className="object-cover object-[65%_center] opacity-90 dark:opacity-[0.35]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--card))_0%,hsl(var(--card)/0.96)_18%,hsl(var(--card)/0.2)_65%,hsl(var(--card)/0)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--card)/0)_65%,hsl(var(--card))_100%)]" />
      </div>

      <header>
        <Button asChild variant="outline" size="icon" className="h-11 w-11 rounded-full border-border/60 bg-card/90 shadow-sm">
          <Link href={returnTo} replace aria-label="Back to previous page"><ArrowLeft aria-hidden="true" /></Link>
        </Button>
        <h1 className="mt-7 max-w-[190px] text-[28px] font-bold leading-[1.08] tracking-tight md:mt-8 md:max-w-xs md:text-4xl">Find Your <br />Next Game</h1>
        <p className="mt-2 max-w-[175px] text-xs leading-relaxed text-muted-foreground md:max-w-[230px] md:text-sm">Discover public sports sessions near you.</p>
      </header>

      <form
        className="mt-6"
        noValidate
        onChange={onEdit}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const formData = new FormData(event.currentTarget);
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          if (submitter instanceof HTMLButtonElement && submitter.dataset.sport !== undefined) {
            formData.set("sport", submitter.dataset.sport);
          }
          onApply(formData);
        }}
      >
        <fieldset disabled={busy} className="min-w-0 [color-scheme:light] dark:[color-scheme:dark]">
          <legend className="sr-only">Search and filter sessions</legend>
          <div className="flex min-h-[52px] items-center rounded-lg border border-border/70 bg-card p-1 shadow-[0_3px_10px_hsl(var(--foreground)/0.08)] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <Button type="submit" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Search"><Search aria-hidden="true" /></Button>
            <Label htmlFor={`${id}-q`} className="sr-only">Search sports or venues</Label>
            <input id={`${id}-q`} name="q" type="search" maxLength={100} defaultValue={filters.q ?? ""} placeholder="Search sports or venues" className="h-11 min-w-0 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground disabled:opacity-50 md:text-sm" {...fieldAccessibility(id, "q", errors)} />
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Filters" aria-expanded={expanded} aria-controls={`${id}-filter-panel`} onClick={onToggleFilters} disabled={busy || state.status === "invalid"}><SlidersHorizontal aria-hidden="true" /></Button>
          </div>
          {errors.q && <p id={`${id}-q-error`} className="mt-2 text-sm text-destructive">{errors.q.join(" ")}</p>}

          {/* Hiding, rather than unmounting, preserves all unsubmitted filter drafts. */}
          <section id={`${id}-filter-panel`} aria-labelledby={`${id}-filters-heading`} className={cn("mt-4 rounded-lg border bg-card p-4", !expanded && "hidden")}>
            <h2 id={`${id}-filters-heading`} className="text-base font-semibold">Filter sessions</h2>
            <p id={`${id}-time-zone`} className="mt-1 text-xs leading-relaxed text-muted-foreground">Dates and times use Singapore time (SGT). Time filters match when a session starts.</p>
            <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
              <FilterField id={id} name="sport" label="Sport" errors={errors}>
                <select id={`${id}-sport`} name="sport" defaultValue={filters.sport} className={selectClassName} {...fieldAccessibility(id, "sport", errors)}>
                  <option value="">All sports</option>
                  {SPORTS.map((sport) => <option key={sport} value={sport}>{sport}</option>)}
                </select>
              </FilterField>
              <FilterField id={id} name="region" label="Region" errors={errors}>
                <select id={`${id}-region`} name="region" defaultValue={filters.region} className={selectClassName} {...fieldAccessibility(id, "region", errors)}>
                  <option value="">All regions</option>
                  {REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                </select>
              </FilterField>
              <FilterField id={id} name="date" label="Date" errors={errors}>
                <Input id={`${id}-date`} name="date" type="date" className="h-11 min-w-0" defaultValue={filters.date} {...fieldAccessibility(id, "date", errors)} />
              </FilterField>
              <div className="grid min-w-0 grid-cols-2 gap-3">
                <FilterField id={id} name="timeFrom" label="From" errors={errors}>
                  <Input id={`${id}-timeFrom`} name="timeFrom" type="time" step="60" className="h-11 min-w-0" defaultValue={filters.timeFrom} {...fieldAccessibility(id, "timeFrom", errors)} />
                </FilterField>
                <FilterField id={id} name="timeTo" label="To" errors={errors}>
                  <Input id={`${id}-timeTo`} name="timeTo" type="time" step="60" className="h-11 min-w-0" defaultValue={filters.timeTo} {...fieldAccessibility(id, "timeTo", errors)} />
                </FilterField>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" className="h-11">Apply filters</Button>
              <Button variant="outline" className="h-11" onClick={(event) => {
                event.currentTarget.form?.reset();
                onClear();
              }}>Clear filters</Button>
            </div>
          </section>
        </fieldset>
        <section aria-labelledby={`${id}-sports-heading`} className="mt-6">
          <h2 id={`${id}-sports-heading`} className="text-sm font-semibold">Explore sports</h2>
          <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto rounded-md px-1 pb-2 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" role="group" aria-label="Choose a sport" tabIndex={0}>
            {["", ...sportChoices].map((sport) => (
              <Button key={sport} type="submit" data-sport={sport} disabled={busy} variant={filters.sport === sport ? "default" : "outline"} aria-pressed={filters.sport === sport} className="h-11 shrink-0 gap-2 px-3 text-xs">
                <SportIcon sport={sport} />{sport || "All sports"}
              </Button>
            ))}
          </div>
        </section>
      </form>

      <section aria-label="Upcoming sessions" aria-busy={busy} className="mt-5 space-y-3">
        <div className="border-b pb-3">
          <h2 className="text-sm font-semibold md:text-lg">Upcoming sessions</h2>
          <p aria-label="Applied filters" className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{summarizeFilters(filters) || "All upcoming public sessions"}</p>
        </div>
        <SearchResults state={state} onNext={onNext} onRetry={onRetry} />
      </section>
    </div>
  );
}

function SportIcon({ sport }: { readonly sport: string }) {
  const Icon = sport === "" ? Grid2X2 : sport === "Badminton" ? Feather : sport === "Volleyball" ? Volleyball : CircleDot;
  return <Icon aria-hidden="true" />;
}

function summarizeFilters(filters: DiscoveryFilters): string {
  const time = filters.timeFrom && filters.timeTo ? `${filters.timeFrom}–${filters.timeTo} SGT`
    : filters.timeFrom ? `From ${filters.timeFrom} SGT` : filters.timeTo ? `Before ${filters.timeTo} SGT` : "";
  return [filters.q ? `“${filters.q}”` : "", filters.sport, filters.region, filters.date, time].filter(Boolean).join(" · ");
}

function fieldAccessibility(id: string, name: keyof DiscoveryFilters, errors: DiscoveryFieldErrors) {
  return {
    "aria-invalid": errors[name] !== undefined || undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : name === "date" || name === "timeFrom" || name === "timeTo" ? `${id}-time-zone` : undefined,
  };
}

function FilterField({ id, name, label, errors, children }: {
  readonly id: string;
  readonly name: keyof DiscoveryFilters;
  readonly label: string;
  readonly errors: DiscoveryFieldErrors;
  readonly children: React.ReactNode;
}) {
  return <div className="min-w-0 space-y-2"><Label htmlFor={`${id}-${name}`}>{label}</Label>{children}{errors[name] && <p id={`${id}-${name}-error`} className="text-sm text-destructive">{errors[name]?.join(" ")}</p>}</div>;
}

function SearchResults({ state, onNext, onRetry }: Pick<DiscoverySearchViewProps, "state" | "onNext" | "onRetry">) {
  switch (state.status) {
    case "loading":
      return <LoadingSpinner label="Loading sessions…" />;
    case "invalid":
      return <ErrorMessage>{state.fieldErrors.cursor?.join(" ") ?? "Please fix the highlighted filters, then search again."}</ErrorMessage>;
    case "error":
      return <div className="space-y-3"><ErrorMessage>{state.kind === "unavailable" ? "Session discovery is not available yet." : "We couldn't load sessions. Please try again."}</ErrorMessage><Button variant="outline" className="h-11" onClick={onRetry}>Retry</Button></div>;
    case "ready": {
      const cursor = state.page.nextCursor;
      return <>
        {state.page.items.length === 0 ? <EmptyState title="No sessions found" description="Try another search, sport, region, or date, or clear your filters to see all upcoming public sessions." /> : <ul className="space-y-3">{state.page.items.map((session) => <CompactSessionCard key={session.sessionId} session={session} />)}</ul>}
        {cursor !== null && <nav aria-label="Session result pages" className="flex justify-end pt-2"><Button variant="outline" className="h-11" onClick={() => onNext(cursor)}>Next page</Button></nav>}
      </>;
    }
    default: {
      const unsupported: never = state;
      throw new Error(`Unsupported discovery state: ${String(unsupported)}`);
    }
  }
}

const singaporeDate = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" });
const singaporeTime = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit" });
const singaporeDateTime = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function CompactSessionCard({ session }: { readonly session: DiscoveryPage["items"][number] }) {
  const start = new Date(session.startAt);
  const end = new Date(session.endAt);
  const sameDay = singaporeDate.format(start) === singaporeDate.format(end);
  return (
    <li className="flex min-w-0 gap-3 rounded-lg border border-border/70 bg-card p-2 shadow-[0_2px_5px_hsl(var(--foreground)/0.06)] sm:gap-5 sm:p-3">
      <div className="relative min-h-[148px] w-[96px] shrink-0 overflow-hidden rounded-md sm:min-h-[160px] sm:w-[180px]">
        <Image src={sportImage(session.sport)} alt="" fill sizes="(max-width: 639px) 96px, 180px" className="object-cover" />
      </div>
      <div className="min-w-0 flex-1 py-1 pr-1 sm:py-2">
        <h3 className="break-words text-sm font-semibold leading-snug sm:text-lg">{session.sport} session</h3>
        <dl className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground sm:text-sm">
          <div className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3 w-3 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" /><dt className="sr-only">Venue and region</dt><dd className="min-w-0 break-words">{session.venueName} · {session.region}</dd></div>
          <div className="flex items-start gap-1.5"><CalendarDays className="mt-0.5 h-3 w-3 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" /><dt className="sr-only">Date</dt><dd><time dateTime={session.startAt}>{singaporeDate.format(start)}</time></dd></div>
          <div className="flex items-start gap-1.5"><Clock3 className="mt-0.5 h-3 w-3 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" /><dt className="sr-only">Session time in Singapore</dt><dd className="min-w-0"><time dateTime={session.startAt}>{singaporeTime.format(start)}</time> – <time dateTime={session.endAt}>{sameDay ? singaporeTime.format(end) : singaporeDateTime.format(end)}</time> SGT</dd></div>
          <div className="flex items-start gap-1.5"><Users className="mt-0.5 h-3 w-3 shrink-0 sm:h-4 sm:w-4" aria-hidden="true" /><dt>Total capacity</dt><dd>{session.totalSlots}</dd></div>
        </dl>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
          <dl><dt className="sr-only">Booking share</dt><dd className="flex flex-wrap items-baseline gap-x-1.5"><Money cents={session.bookingShareCents} className="text-base font-semibold sm:text-xl" /><span className="text-[10px] text-muted-foreground sm:text-xs">per person</span></dd></dl>
          <JoinSessionButton session={session} />
        </div>
      </div>
    </li>
  );
}
