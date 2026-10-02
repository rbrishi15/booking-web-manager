"use client";

import { ArrowUpRight, CloudSun, Search } from "lucide-react";
import Link from "next/link";
import { BookingLogo } from "@/components/ui/booking-logo";
import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/ui/error-message";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { HomeBooking, HomeState, WeatherState } from "../types";

export interface HomeViewProps {
  readonly state: HomeState;
  readonly onRetry: () => void;
}

/** Synchronous Home UI. Personal bookings and the empty-state forecast are server-owned. */
export function HomeView({ state, onRetry }: HomeViewProps) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 pb-10 pt-6 md:px-8 md:pb-12 md:pt-0 xl:px-12">
      <header className="hidden min-h-[208px] flex-col justify-center pb-8 pt-10 md:flex lg:min-h-[224px]">
        <BookingLogo className="text-5xl lg:text-6xl" />
        <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground lg:text-lg">Make time to play.</p>
      </header>
      <section aria-labelledby="home-bookings-heading" aria-busy={state.status === "loading"}>
        <h1 id="home-bookings-heading" className="text-2xl font-bold tracking-tight lg:text-[28px]">Upcoming Bookings</h1>
        <div className="mt-3 md:mt-5">
          <HomeContent state={state} onRetry={onRetry} />
        </div>
      </section>
    </div>
  );
}

function HomeContent({ state, onRetry }: HomeViewProps) {
  switch (state.status) {
    case "loading":
      return <LoadingSpinner label="Loading your bookings…" />;
    case "ready":
      return (
        <ul className="grid gap-3 lg:grid-cols-2 lg:gap-5">
          {state.bookings.map((booking) => <BookingCard key={booking.sessionId} booking={booking} />)}
        </ul>
      );
    case "empty":
      return (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">You have no upcoming bookings.</p>
          <WeatherCard weather={state.weather} />
        </div>
      );
    case "error":
      return (
        <div className="max-w-xl space-y-3">
          <ErrorMessage>{state.kind === "unavailable" ? "Your bookings are temporarily unavailable." : "We couldn't load your bookings. Please try again."}</ErrorMessage>
          <Button variant="outline" className="min-h-11" onClick={onRetry}>Retry</Button>
        </div>
      );
    default:
      return exhaustiveState(state);
  }
}

const singaporeDate = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric",
});
const singaporeTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit",
});
const singaporeDateTime = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});

function BookingCard({ booking }: { readonly booking: HomeBooking }) {
  const start = new Date(booking.startAt);
  const end = new Date(booking.endAt);
  const dateParts = singaporeDate.formatToParts(start);
  const day = dateParts.find(({ type }) => type === "day")?.value;
  const month = dateParts.find(({ type }) => type === "month")?.value;
  const year = dateParts.find(({ type }) => type === "year")?.value;
  const sameDay = singaporeDate.format(start) === singaporeDate.format(end);

  return (
    <li className="min-w-0 rounded-md border border-border/75 bg-card shadow-[0_2px_6px_hsl(var(--foreground)/0.08)]">
      <article className="flex min-h-[112px] items-stretch p-3 md:min-h-[140px] md:p-5" aria-label={`${booking.sport} booking at ${booking.venueName}`}>
        <time dateTime={booking.startAt} aria-label={singaporeDate.format(start)} className="flex w-[72px] shrink-0 flex-col items-center justify-center border-r pr-3 md:w-[88px] md:pr-5">
          <span className="text-[24px] font-bold leading-none md:text-[32px]">{day}</span>
          <span className="mt-1 text-[10px] font-semibold uppercase leading-none md:text-xs">{month}</span>
          <span className="mt-1.5 text-[10px] leading-none text-muted-foreground">{year}</span>
        </time>
        <div className="flex min-w-0 flex-1 flex-col justify-center py-1 pl-5 md:pl-6">
          <h2 className="break-words text-sm font-semibold leading-snug md:text-base">{booking.sport} Booking</h2>
          <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground md:text-sm">{booking.venueName}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground md:text-xs">
            <span className="sr-only">Singapore time: </span>
            <time dateTime={booking.startAt}>{singaporeTime.format(start)}</time> – <time dateTime={booking.endAt}>{sameDay ? singaporeTime.format(end) : singaporeDateTime.format(end)}</time> SGT
          </p>
        </div>
      </article>
    </li>
  );
}

function WeatherCard({ weather }: { readonly weather: WeatherState }) {
  return (
    <div className="max-w-3xl overflow-hidden rounded-xl border bg-card shadow-[0_4px_20px_hsl(var(--foreground)/0.04)]">
      <div className="p-5 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Singapore weather</h2>
            <p className="mt-1 text-xs text-muted-foreground">24-hour forecast</p>
          </div>
          <CloudSun className="h-10 w-10 shrink-0 text-muted-foreground" strokeWidth={1.25} aria-hidden />
        </div>
        {weather.status === "ready" ? (
          <>
            <p className="mt-6 text-[38px] font-semibold leading-none tracking-tight md:text-5xl">
              <span className="sr-only">Forecast temperature range: </span>{weather.lowCelsius}–{weather.highCelsius}<span className="ml-1 text-2xl font-normal text-muted-foreground">°C</span>
            </p>
            <p className="mt-3 text-base leading-relaxed">{weather.forecast}</p>
            <dl className="mt-5 space-y-2 text-xs leading-relaxed text-muted-foreground">
              <div>
                <dt className="font-medium">Forecast period (SGT)</dt>
                <dd className="mt-0.5"><time dateTime={weather.validFrom}>{singaporeDateTime.format(new Date(weather.validFrom))}</time> – <time dateTime={weather.validTo}>{singaporeDateTime.format(new Date(weather.validTo))}</time></dd>
              </div>
              <div className="flex flex-wrap gap-x-1">
                <dt>Updated</dt>
                <dd><time dateTime={weather.updatedAt}>{singaporeDateTime.format(new Date(weather.updatedAt))}</time> SGT</dd>
              </div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
              <a href="https://data.gov.sg/datasets/d_ce2eb1e307bda31993c533285834ef2b/view" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                Source: NEA / data.gov.sg <ArrowUpRight className="h-3 w-3" aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a href="https://data.gov.sg/open-data-licence" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                Singapore Open Data Licence<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </>
        ) : (
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground">Weather is unavailable right now. You can still find a session for your next game.</p>
        )}
      </div>
      <div className="border-t bg-muted/30 px-5 py-4 md:px-7">
        <Button asChild variant="outline" className="min-h-11 bg-card">
          <Link href="/discover?returnTo=%2F"><Search className="h-4 w-4" aria-hidden />Find a session</Link>
        </Button>
      </div>
    </div>
  );
}

function exhaustiveState(state: never): never {
  throw new Error(`Unsupported Home state: ${String(state)}`);
}
