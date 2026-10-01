"use client";

import { CalendarDays, MapPin, Users } from "lucide-react";
import { useId } from "react";
import { REGIONS, SPORTS } from "@/app/(auth)/schemas";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorMessage } from "@/components/ui/error-message";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import type { DiscoveryPage } from "../contracts";
import type { DiscoveryFieldErrors, DiscoveryFilters } from "../query";
import type { DiscoveryState } from "./discovery-state";

export interface DiscoveryViewProps {
  readonly filters: DiscoveryFilters;
  readonly state: DiscoveryState;
  readonly onApply: (formData: FormData) => void;
  readonly onEdit: () => void;
  readonly onClear: () => void;
  readonly onNext: (cursor: string) => void;
  readonly onRetry: () => void;
}

const selectClassName = "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 md:text-sm";

/** Synchronous UI shared by the page and stories. Draft fields are deliberately uncontrolled. */
export function DiscoveryView({ filters, state, onApply, onEdit, onClear, onNext, onRetry }: DiscoveryViewProps) {
  const id = useId();
  const busy = state.status === "loading";
  const errors: DiscoveryFieldErrors = state.status === "invalid" ? state.fieldErrors : {};

  return (
    <>
      <PageHeader breadcrumb="Home" title="Discover sessions" />
      <div className="space-y-6 p-4 md:p-8">
        <section className="rounded-lg border bg-card p-4 md:p-6" aria-labelledby={`${id}-filters`}>
          <h2 id={`${id}-filters`} className="text-lg font-semibold">Find your next session</h2>
          <p id={`${id}-time-zone`} className="mt-1 text-sm text-muted-foreground">
            Dates and times use Singapore time (SGT). Time filters match when a session starts.
          </p>
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
                <Input id={`${id}-date`} name="date" type="date" defaultValue={filters.date} {...fieldAccessibility(id, "date", errors)} />
              </FilterField>
              <FilterField id={id} name="timeFrom" label="From" errors={errors}>
                <Input id={`${id}-timeFrom`} name="timeFrom" type="time" step="60" defaultValue={filters.timeFrom} {...fieldAccessibility(id, "timeFrom", errors)} />
              </FilterField>
              <FilterField id={id} name="timeTo" label="To" errors={errors}>
                <Input id={`${id}-timeTo`} name="timeTo" type="time" step="60" defaultValue={filters.timeTo} {...fieldAccessibility(id, "timeTo", errors)} />
              </FilterField>
              <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-5">
                <Button type="submit" disabled={busy}>Apply filters</Button>
                <Button
                  variant="outline"
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

        <section aria-labelledby={`${id}-results`} aria-busy={busy} className="space-y-4">
          <h2 id={`${id}-results`} className="text-xl font-semibold">Upcoming sessions</h2>
          <DiscoveryResults state={state} onNext={onNext} onRetry={onRetry} />
        </section>
      </div>
    </>
  );
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
          <Button variant="outline" onClick={onRetry}>Retry</Button>
        </div>
      );
    case "ready": {
      const cursor = state.page.nextCursor;
      return (
        <>
          {state.page.items.length === 0 ? (
            <EmptyState title="No sessions found" description="Try another sport, region, or date, or clear your filters to see all upcoming public sessions." />
          ) : (
            <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {state.page.items.map((session) => <SessionCard key={session.sessionId} session={session} />)}
            </ul>
          )}
          {cursor !== null && (
            <nav aria-label="Session result pages" className="flex justify-end">
              <Button variant="outline" onClick={() => onNext(cursor)}>Next page</Button>
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

function SessionCard({ session }: { readonly session: DiscoveryPage["items"][number] }) {
  return (
    <li className="min-w-0 rounded-lg border bg-card p-5">
      <p className="text-sm font-medium text-primary">{session.sport}</p>
      <h3 className="mt-1 break-words text-lg font-semibold">{session.venueName}</h3>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Region</dt><dd>{session.region}</dd>
        </div>
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="sr-only">Session time in Singapore</dt>
          <dd className="min-w-0">
            <time dateTime={session.startAt}>{singaporeDateTime.format(new Date(session.startAt))}</time>
            <span className="block">to <time dateTime={session.endAt}>{singaporeDateTime.format(new Date(session.endAt))}</time> SGT</span>
          </dd>
        </div>
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <dt>Total capacity</dt><dd>{session.totalSlots}</dd>
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
          <dt className="text-muted-foreground">Booking share</dt>
          <dd><Money cents={session.bookingShareCents} className="text-lg font-semibold" /></dd>
        </div>
      </dl>
    </li>
  );
}
