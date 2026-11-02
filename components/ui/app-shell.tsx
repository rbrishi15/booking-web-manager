"use client";

import { LogOut, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BookingLogo } from "@/components/ui/booking-logo";
import { initials } from "@/components/ui/initials";
import { NavigationIcon } from "@/components/ui/navigation-icon";
import { MobileNavigation } from "@/components/ui/mobile-navigation";
import { toFivePoint } from "@/components/ui/reliability-badge";
import { cn } from "@/lib/utils";
import { discoveryHref, discoveryReturnTo } from "@/app/discover/navigation";
import { useNewNotifications } from "@/app/notifications/provider";
import styles from "./app-shell.module.css";

const NAV_LINKS = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/discover", label: "Discover", icon: "search" },
  { href: "/sessions", label: "My sessions", icon: "sessions" },
  { href: "/wallet", label: "Wallet", icon: "wallet" },
  { href: "/groups", label: "Groups", icon: "groups" },
  { href: "/notifications", label: "Notifications", icon: "notifications" },
  { href: "/profile", label: "Settings", icon: "settings" },
] as const;

export interface ShellUser {
  readonly name: string;
  /** 0–100, or null when the score couldn't be read (shown as unavailable, not as a default). */
  readonly reliabilityScore: number | null;
}

/** "Reliability 4.8", or "Reliability unavailable" when the score couldn't be read. */
function reliabilityText(score: number | null): string {
  return score === null ? "Reliability unavailable" : `Reliability ${toFivePoint(score)}`;
}

interface AppShellProps {
  readonly user: ShellUser;
  
  readonly logoutAction?: () => Promise<void>;
  readonly children: React.ReactNode;
  readonly mobileVariant?: "standard" | "focused";
}


/** Renders active-route navigation and account details, with optional logout and navigation callbacks. */
function SidebarContents({
  user,
  logoutAction,
  onNavigate,
  searchHref,
  hasNewNotifications,
}: {
  readonly user: ShellUser;
  readonly logoutAction?: () => Promise<void>;
  readonly onNavigate?: () => void;
  readonly searchHref: string;
  readonly hasNewNotifications: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className={cn(styles.sidebarContents, "flex h-full flex-col overflow-y-auto px-4 py-7 lg:px-5 lg:py-8")}>
      <div className="px-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="inline-flex min-h-11 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <BookingLogo />
        </Link>
        <p className="mt-1 text-xs text-muted-foreground">Find your next game.</p>
      </div>

      {/* Navigation links */}
      <nav className="mt-10 flex flex-col gap-2 lg:mt-12" aria-label="Main">
        {NAV_LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href === "/discover" ? searchHref : link.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] items-center gap-3 rounded-lg px-3 py-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:gap-4",
                active && "bg-accent font-semibold",
              )}
            >
              <NavigationIcon name={link.icon} active={active} />
              {link.label}
              {link.href === "/notifications" && hasNewNotifications && <span aria-label="New notifications" className="ml-auto rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">New</span>}
            </Link>
          );
        })}
      </nav>

      {/* Your account (bottom) */}
      <div className="mt-auto pt-10">
        <div className="border-t pt-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold">
              {initials(user.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">
                {reliabilityText(user.reliabilityScore)}
              </p>
            </div>
          </div>
          {logoutAction !== undefined && (
            <form action={logoutAction} className="mt-3">
              <button
                type="submit"
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Log out
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}


/** Frames signed-in content with a desktop sidebar, mobile navigation and a direct notification shortcut. */
export function AppShell({ user, logoutAction, children, mobileVariant = "standard" }: AppShellProps) {
  const pathname = usePathname();
  const hasNewNotifications = useNewNotifications();
  const notificationsLayout = pathname === "/notifications";
  const walletLayout = pathname === "/wallet" || pathname.startsWith("/wallet/");
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const origins = searchParams.getAll("returnTo");
  const searchOrigin = pathname === "/discover"
    ? discoveryReturnTo(origins.length === 1 ? origins[0] : undefined)
    : `${pathname}${query ? `?${query}` : ""}`;
  const searchHref = discoveryHref("", searchOrigin);

  return (
    <div className="flex min-h-screen bg-card md:bg-background">
      {/* Desktop sidebar (hidden below 768px) */}
      <aside className="sticky top-4 my-4 ml-4 hidden h-[calc(100dvh-2rem)] w-52 shrink-0 rounded-2xl border border-border/40 bg-card shadow-[0_8px_32px_-16px_hsl(var(--foreground)/0.08)] md:block lg:w-60 2xl:w-64">
        <SidebarContents user={user} logoutAction={logoutAction} searchHref={searchHref} hasNewNotifications={hasNewNotifications} />
      </aside>

      <div className="relative isolate flex min-w-0 flex-1 flex-col">
        {/* The desktop court fades behind the page introduction without competing with its content. */}
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-[420px] overflow-hidden", mobileVariant === "standard" && !walletLayout && !notificationsLayout && "md:block")} aria-hidden="true">
          <Image
            src="/images/mobile-hero.png"
            alt=""
            fill
            sizes="(min-width: 768px) calc(100vw - 256px), 1px"
            className="object-cover object-right-top opacity-[0.35] dark:opacity-[0.14]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--background))_0%,hsl(var(--background)/0.3)_40%,hsl(var(--background)/0)_70%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,hsl(var(--background)/0)_0%,hsl(var(--background)/0.2)_45%,hsl(var(--background))_100%)]" />
        </div>
        {/* Figma's hero: an oversized image at 50%, with left and bottom fades into the page. */}
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 -z-10 h-[295px] overflow-hidden md:hidden", (mobileVariant === "focused" || notificationsLayout) && "hidden")} aria-hidden="true">
          <div className="absolute -top-2.5 left-1/2 h-[295px] w-[calc(100%+148px)] -translate-x-1/2">
            <Image
              src="/images/mobile-hero.png"
              alt=""
              fill
              sizes="(max-width: 767px) calc(100vw + 148px), 1px"
              className="object-cover object-top opacity-50 dark:opacity-[0.15]"
            />
          </div>
          <div className="absolute -left-2.5 top-3.5 h-72 w-[64.4%] bg-[linear-gradient(to_left,hsl(var(--card)/0)_0%,hsl(var(--card)/0.25)_12.5%,hsl(var(--card)/0.5)_25%,hsl(var(--card))_50%)] dark:top-0" />
          <div className="absolute inset-x-0 -top-[19px] h-[430px] bg-[linear-gradient(to_bottom,hsl(var(--card)/0)_0%,hsl(var(--card)/0.25)_12.5%,hsl(var(--card)/0.5)_25%,hsl(var(--card))_50%)]" />
        </div>
        <header className={cn("relative px-6 pb-6 pt-5 md:hidden", walletLayout && "pb-[31px]", mobileVariant === "focused" && "hidden")}>
          <div className={cn("mb-4 flex items-center justify-between", walletLayout && "mb-2")}>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <BookingLogo className={walletLayout ? "text-lg" : undefined} />
            </Link>
            <div className="flex items-center gap-2">
              {walletLayout ? (
                <Link
                  href="/sessions/create"
                  aria-label="Create session"
                  className="flex h-11 w-11 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              ) : null}
              <Button asChild variant="ghost" size="icon" className="relative h-11 w-11 rounded-md [&_svg]:size-5">
                <Link
                  href="/notifications"
                  aria-label={hasNewNotifications ? "Notifications, new updates" : "Notifications"}
                  aria-current={notificationsLayout ? "page" : undefined}
                >
                  <NavigationIcon name="notifications" active={notificationsLayout} />
                  {hasNewNotifications && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-foreground ring-2 ring-card" aria-hidden />}
                </Link>
              </Button>
            </div>
          </div>

          <MobileNavigation pathname={pathname} enabled={mobileVariant === "standard"} compact={walletLayout} />
        </header>

        {/* Page content */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
