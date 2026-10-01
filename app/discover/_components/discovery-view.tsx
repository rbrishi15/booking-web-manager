"use client";

import { ChevronDown, Clock3, MapPin, SlidersHorizontal, Users } from "lucide-react";
import Image from "next/image";
import { useId } from "react";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
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
import { DiscoveryHero } from "./discovery-hero";

export interface DiscoveryViewProps {
  readonly filters: DiscoveryFilters;
  readonly state: DiscoveryState;
  readonly filterPanel: FilterPanelState;
  readonly onToggleFilters: () => void;
  readonly onApply: (formData: FormData) => void;
  readonly onEdit: () => void;
  readonly onClear: () => void;
  readonly onNext: (cursor: string) => void;
  readonly onRetry: () => void;
}

const selectClassName = "flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:h-10 md:text-sm";

/** Synchronous UI shared by the page and stories. Draft fields are deliberately uncontrolled. */
export function DiscoveryView({ filters, state, filterPanel, onToggleFilters, onApply, onEdit, onClear, onNext, onRetry }: DiscoveryViewProps) {
  const id = useId();
  const busy = state.status === "loading";
  const errors: DiscoveryFieldErrors = state.status === "invalid" ? state.fieldErrors : {};
  const expanded = filterPanel === "expanded";
  const appliedSummary = summarizeFilters(filters);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 pb-10 pt-6 md:px-8 md:pb-12 md:pt-0 xl:px-12">
      <DiscoveryHero />
      <div className="flex flex-col gap-6 md:gap-8">
        <header className="md:hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-3">
            <h1 className="text-2xl font-bold tracking-tight">Discover sessions</h1>
            <Button variant="outline" className="h-11 px-3" aria-expanded={expanded} aria-controls={`${id}-filter-panel`} onClick={onToggleFilters} disabled={busy || state.status === "invalid"}>
              <SlidersHorizontal aria-hidden />Filters<ChevronDown aria-hidden className={cn("transition-transform", expanded && "rotate-180")} />
            </Button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground" aria-label="Applied filters">{appliedSummary || "Find your next game. All upcoming public sessions."}</p>
        </header>
        {/* CSS hides the panel without unmounting uncontrolled draft inputs. */}
        <section id={`${id}-filter-panel`} className={cn("rounded-lg border bg-card p-4 md:block md:border-border/70 md:p-5 md:shadow-[0_4px_24px_hsl(var(--foreground)/0.03)] xl:p-6", !expanded && "hidden")} aria-labelledby={`${id}-filters`}>
          <div className="xl:flex xl:items-baseline xl:justify-between xl:gap-4">
            <h2 id={`${id}-filters`} className="text-lg font-semibold">Find your next session</h2>
            <p id={`${id}-time-zone`} className="mt-1 text-sm text-muted-foreground xl:max-w-sm xl:text-right xl:text-xs">
              Dates and times use Singapore time (SGT). Time filters match when a session starts.
            </p>
          </div>
          <form
            className="mt-5"
            noValidate
            onChange={onEdit}
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) onApply(new FormData(event.currentTarget));
            }}
          >
            <fieldset disabled={busy} className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <legend className="sr-only">Session filters</legend>
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
                <Input id={`${id}-date`} name="date" type="date" className="min-w-0 h-11 md:h-10" defaultValue={filters.date} {...fieldAccessibility(id, "date", errors)} />
              </FilterField>
              <FilterField id={id} name="timeFrom" label="From" errors={errors}>
                <Input id={`${id}-timeFrom`} name="timeFrom" type="time" step="60" className="min-w-0 h-11 md:h-10" defaultValue={filters.timeFrom} {...fieldAccessibility(id, "timeFrom", errors)} />
              </FilterField>
              <FilterField id={id} name="timeTo" label="To" errors={errors}>
                <Input id={`${id}-timeTo`} name="timeTo" type="time" step="60" className="min-w-0 h-11 md:h-10" defaultValue={filters.timeTo} {...fieldAccessibility(id, "timeTo", errors)} />
              </FilterField>
              <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-5">
                <Button type="submit" className="h-11 md:h-10" disabled={busy}>Apply filters</Button>
                <Button
                  variant="outline"
                  className="h-11 md:h-10"
                  disabled={busy}
                  onClick={(event) => {
                    // Clear also discards edits when the committed URL is already unfiltered.
                    event.currentTarget.form?.reset();
                    onClear();
                  }}
                >Clear filters</Button>
              </div>
            </fieldset>
          </form>
        </section>

        <section aria-label="Upcoming sessions" aria-busy={busy} className="space-y-4 md:space-y-5">
          <div className="hidden items-end justify-between gap-4 md:flex">
            <h2 className="text-2xl font-bold tracking-tight lg:text-[28px]">Discover sessions</h2>
            <p className="max-w-[45%] text-right text-sm leading-relaxed text-muted-foreground">{appliedSummary || "Upcoming public sessions"}</p>
          </div>
          <h2 className="sr-only md:hidden">Upcoming sessions</h2>
          <DiscoveryResults state={state} onNext={onNext} onRetry={onRetry} />
        </section>
      </div>
    </div>
  );
}

/** The summary describes applied URL values, never the unsubmitted form draft. */
function summarizeFilters(filters: DiscoveryFilters): string {
  const time = filters.timeFrom && filters.timeTo
    ? `${filters.timeFrom}–${filters.timeTo} SGT`
    : filters.timeFrom ? `From ${filters.timeFrom} SGT` : filters.timeTo ? `Before ${filters.timeTo} SGT` : "";
  return [filters.sport, filters.region, filters.date, time].filter(Boolean).join(" · ");
}

function fieldAccessibility(id: string, name: keyof DiscoveryFilters, errors: DiscoveryFieldErrors) {
  return {
    "aria-invalid": errors[name] !== undefined || undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error ${id}-time-zone` : `${id}-time-zone`,
  };
}

function FilterField({ id, name, label, errors, children }: {
  readonly id: string;
  readonly name: keyof DiscoveryFilters;
  readonly label: string;
  readonly errors: DiscoveryFieldErrors;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={`${id}-${name}`}>{label}</Label>
      {children}
      {errors[name] && <p id={`${id}-${name}-error`} className="text-sm text-destructive">{errors[name]?.join(" ")}</p>}
    </div>
  );
}

function DiscoveryResults({ state, onNext, onRetry }: Pick<DiscoveryViewProps, "state" | "onNext" | "onRetry">) {
  switch (state.status) {
    case "loading":
      return <LoadingSpinner label="Loading sessions…" />;
    case "invalid":
      return <ErrorMessage>{state.fieldErrors.cursor?.join(" ") ?? "Please fix the highlighted filters, then apply them again."}</ErrorMessage>;
    case "error":
      return (
        <div className="space-y-3">
          <ErrorMessage>{state.kind === "unavailable" ? "Session discovery is not available yet." : "We couldn't load sessions. Please try again."}</ErrorMessage>
          <Button variant="outline" className="h-11 md:h-10" onClick={onRetry}>Retry</Button>
        </div>
      );
    case "ready": {
      const cursor = state.page.nextCursor;
      return (
        <>
          {state.page.items.length === 0 ? (
            <EmptyState title="No sessions found" description="Try another sport, region, or date, or clear your filters to see all upcoming public sessions." />
          ) : (
            <ul className="grid gap-6 lg:grid-cols-2">
              {state.page.items.map((session) => <SessionCard key={session.sessionId} session={session} />)}
            </ul>
          )}
          {cursor !== null && (
            <nav aria-label="Session result pages" className="flex justify-end">
              <Button variant="outline" className="h-11 md:h-10" onClick={() => onNext(cursor)}>Next page</Button>
            </nav>
          )}
        </>
      );
    }
    default:
      return exhaustiveState(state);
  }
}

function exhaustiveState(state: never): never {
  throw new Error(`Unsupported discovery state: ${String(state)}`);
}

const singaporeDateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});
const singaporeDate = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric",
});
const singaporeTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit",
});

function SessionCard({ session }: { readonly session: DiscoveryPage["items"][number] }) {
  const start = new Date(session.startAt);
  const end = new Date(session.endAt);
  const sameDay = singaporeDate.format(start) === singaporeDate.format(end);
  return (
    <li className="min-w-0 overflow-hidden rounded-lg border bg-card md:border-border/70 md:shadow-[0_4px_24px_hsl(var(--foreground)/0.04)]">
      <Image src={sportImage(session.sport)} alt="" width={960} height={540} sizes="(max-width: 767px) calc(100vw - 48px), (max-width: 1023px) calc(100vw - 304px), (max-width: 1535px) calc((100vw - 392px) / 2), 660px" className="aspect-video w-full object-cover" />
      <div className="p-5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-4 lg:p-6">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold md:text-lg">
            <time dateTime={session.startAt}>{singaporeDate.format(start)}</time> · {session.sport}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground md:mt-3 md:flex md:items-start md:gap-2">
            <MapPin className="mt-0.5 hidden h-4 w-4 shrink-0 md:block" aria-hidden />
            <span className="min-w-0 break-words">{session.venueName}</span>
          </p>
          <dl className="mt-1 space-y-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2 md:pl-6">
              <dt className="sr-only">Region</dt><dd>{session.region}</dd>
            </div>
            <div className="flex items-start gap-2">
              <Clock3 className="mt-0.5 hidden h-4 w-4 shrink-0 md:block" aria-hidden />
              <dt className="sr-only">Session time in Singapore</dt>
              <dd className="min-w-0">
                <time dateTime={session.startAt}>{singaporeTime.format(start)}</time> – <time dateTime={session.endAt}>{sameDay ? singaporeTime.format(end) : singaporeDateTime.format(end)}</time> SGT
              </dd>
            </div>
            <div className="flex items-start gap-2 text-foreground md:text-muted-foreground">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <dt>Total capacity</dt><dd>{session.totalSlots}</dd>
            </div>
          </dl>
        </div>
        <dl className="mt-2 pt-2 md:mt-0 md:pt-0 md:text-right">
          <dt className="sr-only">Booking share</dt>
          <dd><Money cents={session.bookingShareCents} className="text-xl font-semibold md:text-2xl md:tracking-tight" /><span className="ml-1.5 text-xs md:ml-0 md:mt-1 md:block md:text-sm md:text-muted-foreground">per person</span></dd>
        </dl>
      </div>
    </li>
  );
}
