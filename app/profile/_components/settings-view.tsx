import { CalendarDays, CircleHelp, FileText, Pencil, Plus, ReceiptText, ShieldCheck, Target, Trash2, UserRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { initials } from "@/components/ui/initials";
import { ReliabilityBadge } from "@/components/ui/reliability-badge";
import { SettingsRow } from "./settings-row";

interface SettingsViewProps {
  readonly user: {
    readonly displayName: string;
    /** The public user ID without "@" (ADR-0021); every active account has one. */
    readonly handle?: string | null;
    readonly reliabilityScore: number | null;
    readonly preferredSports: readonly string[];
    readonly preferredRegions: readonly string[];
  };
  readonly notifications?: ReactNode;
}

const panelClassName = "overflow-hidden rounded-lg border bg-card shadow-[0_2px_3px_hsl(var(--foreground)/0.02),0_6px_14px_-6px_hsl(var(--foreground)/0.1)]";

function PreferenceLink({ icon, title, values }: {
  readonly icon: "heart" | "map-pinned";
  readonly title: string;
  readonly values: readonly string[];
}) {
  return (
    <Link
      href="/profile/edit"
      className="flex h-full min-h-24 items-center gap-5 bg-card px-5 py-5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:gap-6 md:px-6"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-900 md:h-12 md:w-12" aria-hidden="true">
        <Image src={`/images/settings/${icon}.svg`} width={16} height={16} alt="" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold tracking-tight md:text-lg">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground md:text-sm">
          {values.length > 0 ? values.join(", ") : "Not set yet"}
        </span>
      </span>
      <Image src="/images/settings/arrow-right.svg" width={24} height={24} alt="" className="shrink-0 dark:invert" />
    </Link>
  );
}

/** Settings presentation; authentication and browser notification state stay with their owners. */
export function SettingsView({ user, notifications }: SettingsViewProps) {
  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-10 pt-2 md:px-8 md:pb-12 md:pt-10 lg:px-12 lg:pt-12">
      <header className="mb-7 hidden items-start justify-between gap-6 md:flex lg:mb-8">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">Account</p>
          <h1 className="text-4xl font-bold tracking-tight lg:text-[40px]">Settings</h1>
          <p className="mt-3 text-base text-muted-foreground">Manage your account, preferences and more.</p>
        </div>
        <Button asChild className="min-h-11 shrink-0 gap-2">
          <Link href="/sessions/create"><Plus className="h-4 w-4" aria-hidden="true" />Create session</Link>
        </Button>
      </header>
      <h1 className="sr-only md:hidden">Settings</h1>

      <section aria-label="Your profile" className={`${panelClassName} flex items-center gap-5 p-5 md:gap-7 md:p-7`}>
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center bg-zinc-900 text-2xl font-normal text-white md:h-24 md:w-24 md:rounded md:text-4xl lg:h-28 lg:w-28"
          aria-hidden="true"
        >
          {initials(user.displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-bold tracking-tight md:text-2xl">{user.displayName}</h2>
          {user.handle != null && <p className="break-all text-sm text-muted-foreground md:text-base">@{user.handle}</p>}
          {user.reliabilityScore === null ? (
            <p className="mt-1 text-sm text-muted-foreground">Reliability score unavailable right now.</p>
          ) : (
            <ReliabilityBadge score={user.reliabilityScore} variant="profile" className="mt-1" />
          )}
          {/* The profile read model has no activity totals yet. Do not display fictional counts. */}
          <dl className="mt-2 grid max-w-md grid-cols-2 divide-x md:mt-5">
            <div className="relative grid min-w-0 grid-rows-[auto_1fr] pr-2 min-[390px]:pl-5 md:pl-9 md:pr-6">
              <dt className="text-[9px] leading-3 text-muted-foreground md:text-xs md:leading-5 lg:text-sm">
                <CalendarDays className="absolute left-0 top-0.5 hidden h-3.5 w-3.5 min-[390px]:block md:h-6 md:w-6" aria-hidden="true" />
                Sessions joined
              </dt>
              <dd className="order-first text-xs font-semibold md:text-lg"><span aria-hidden="true">—</span><span className="sr-only">Not available yet</span></dd>
            </div>
            <div className="relative grid min-w-0 grid-rows-[auto_1fr] pl-3 min-[390px]:pl-7 md:pl-14">
              <dt className="text-[9px] leading-3 text-muted-foreground md:text-xs md:leading-5 lg:text-sm">
                <Target className="absolute left-2 top-0.5 hidden h-3.5 w-3.5 min-[390px]:block md:left-5 md:h-6 md:w-6" aria-hidden="true" />
                Attendance rate
              </dt>
              <dd className="order-first text-xs font-semibold md:text-lg"><span aria-hidden="true">—</span><span className="sr-only">Not available yet</span></dd>
            </div>
          </dl>
        </div>
        <Button asChild variant="outline" className="hidden min-h-11 gap-2 lg:inline-flex">
          <Link href="/profile/edit"><Pencil className="h-4 w-4" aria-hidden="true" />Edit profile</Link>
        </Button>
      </section>

      <section aria-labelledby="preferences-heading" className="mt-8 md:mt-7">
        <h2 id="preferences-heading" className="text-lg font-semibold tracking-tight md:text-2xl">Preferences</h2>
        <p className="mt-1 hidden text-sm text-muted-foreground md:block">Set your default preferences to get better session recommendations.</p>
        <div className="mt-3 grid grid-cols-1 overflow-hidden rounded-lg border bg-card shadow-[0_2px_3px_hsl(var(--foreground)/0.02),0_6px_14px_-6px_hsl(var(--foreground)/0.1)] md:mt-4 lg:grid-cols-2 lg:gap-4 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none">
          <div className="border-b lg:overflow-hidden lg:rounded-lg lg:border lg:shadow-[0_6px_14px_-6px_hsl(var(--foreground)/0.1)]">
            <PreferenceLink icon="heart" title="Preferred sports" values={user.preferredSports} />
          </div>
          <div className="lg:overflow-hidden lg:rounded-lg lg:border lg:shadow-[0_6px_14px_-6px_hsl(var(--foreground)/0.1)]">
            <PreferenceLink icon="map-pinned" title="Preferred regions" values={user.preferredRegions} />
          </div>
        </div>
      </section>

      <section aria-labelledby="account-settings-heading" className="mt-8">
        <h2 id="account-settings-heading" className="text-lg font-semibold tracking-tight md:text-2xl">Account settings</h2>
        <p className="mt-1 hidden text-sm text-muted-foreground md:block">Manage your account, security and support options.</p>
        <div className={`${panelClassName} mt-3 divide-y md:mt-4`}>
          <SettingsRow icon={UserRound} title="Edit profile" href="/profile/edit" />
          <SettingsRow icon={ReceiptText} title="Transaction history" href="/wallet" />
          <SettingsRow icon={ShieldCheck} title="Privacy and security" href="/privacy" />
          <SettingsRow icon={CircleHelp} title="Help and support" href="/profile/help" />
          <SettingsRow icon={FileText} title="Terms and conditions" href="/terms" />
          {notifications}
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-destructive/20 bg-card shadow-sm dark:border-red-400/30">
          <SettingsRow
            icon={Trash2}
            title="Delete account"
            description="Remove your personal details and close your account"
            href="/profile/delete"
            tone="danger"
          />
        </div>
      </section>
    </div>
  );
}
