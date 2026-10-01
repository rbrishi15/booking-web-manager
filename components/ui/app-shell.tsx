"use client";

import { LogOut, Search, UserRound, UsersRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { BookingLogo } from "@/components/ui/booking-logo";
import { initials } from "@/components/ui/initials";
import { toFivePoint } from "@/components/ui/reliability-badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { discoveryHref, discoveryReturnTo } from "@/app/discover/navigation";

const NAV_LINKS = [
  { href: "/", label: "Home", image: "home" },
  { href: "/discover", label: "Discover", image: "search" },
  { href: "/sessions", label: "My sessions", image: "sessions" },
  { href: "/wallet", label: "Wallet", image: "wallet" },
  { href: "/groups", label: "Groups", image: null },
  { href: "/profile", label: "Settings", image: "settings" },
] as const;

const MOBILE_NAV_LINKS = [
  { href: "/", label: "Home", image: "home" },
  { href: "/sessions", label: "Sessions", image: "sessions" },
  { href: "/wallet", label: "Wallet", image: "wallet" },
  { href: "/profile", label: "Settings", image: "settings" },
] as const;

export interface ShellUser {
  readonly name: string;
  
  readonly reliabilityScore: number;
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
}: {
  readonly user: ShellUser;
  readonly logoutAction?: () => Promise<void>;
  readonly onNavigate?: () => void;
  readonly searchHref: string;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-7 lg:px-5 lg:py-8">
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
              {link.image === "search" ? (
                <Search className="h-5 w-5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
              ) : link.image === null ? (
                <UsersRound className="h-5 w-5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
              ) : (
                <Image src={`/images/navigation/${link.image}.svg`} width={20} height={20} alt="" className="shrink-0 dark:invert" />
              )}
              {link.label}
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
                Reliability {toFivePoint(user.reliabilityScore)}
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


/** Frames signed-in content with a desktop sidebar and mobile navigation plus an account sheet. */
export function AppShell({ user, logoutAction, children, mobileVariant = "standard" }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const origins = searchParams.getAll("returnTo");
  const searchOrigin = pathname === "/discover"
    ? discoveryReturnTo(origins.length === 1 ? origins[0] : undefined)
    : `${pathname}${query ? `?${query}` : ""}`;
  const searchHref = discoveryHref("", searchOrigin);
  const activeMobileIndex = MOBILE_NAV_LINKS.findIndex(({ href }) =>
    pathname === href || pathname.startsWith(`${href}/`)
    || (href === "/sessions" && (pathname === "/groups" || pathname.startsWith("/groups/"))),
  );

  return (
    <div className="flex min-h-screen bg-card md:bg-background">
      {/* Desktop sidebar (hidden below 768px) */}
      <aside className="sticky top-4 my-4 ml-4 hidden h-[calc(100dvh-2rem)] w-52 shrink-0 rounded-2xl border border-border/40 bg-card shadow-[0_8px_32px_-16px_hsl(var(--foreground)/0.08)] md:block lg:w-60 2xl:w-64">
        <SidebarContents user={user} logoutAction={logoutAction} searchHref={searchHref} />
      </aside>

      <div className="relative isolate flex min-w-0 flex-1 flex-col">
        {/* The desktop court fades behind the page introduction without competing with its content. */}
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-[420px] overflow-hidden", mobileVariant === "standard" && "md:block")} aria-hidden="true">
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
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 -z-10 h-[295px] overflow-hidden md:hidden", mobileVariant === "focused" && "hidden")} aria-hidden="true">
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
        <header className={cn("relative px-6 pb-6 pt-5 md:hidden", mobileVariant === "focused" && "hidden")}>
          <div className="mb-4 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <BookingLogo />
            </Link>
            <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="h-11 w-11" aria-label="Search sessions">
              <Link href={searchHref}><Search className="h-5 w-5" aria-hidden="true" /></Link>
            </Button>
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button size="icon" className="h-11 w-11 rounded-md" aria-label="Open account menu">
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-72 bg-card p-6 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center"
              >
                <SheetTitle className="pr-10">Your account</SheetTitle>
                <SheetDescription className="sr-only">Account details, settings, and logout</SheetDescription>
                <div className="mt-8 flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {initials(user.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{user.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Reliability {toFivePoint(user.reliabilityScore)}
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" className="mt-6 min-h-11 w-full">
                  <Link href="/groups" onClick={() => setMenuOpen(false)}>
                    My groups
                  </Link>
                </Button>
                <Button asChild variant="outline" className="mt-3 min-h-11 w-full">
                  <Link href="/profile" onClick={() => setMenuOpen(false)}>
                    Account settings
                  </Link>
                </Button>
                {logoutAction !== undefined && (
                  <form action={logoutAction} className="mt-3">
                    <Button type="submit" variant="ghost" className="min-h-11 w-full">
                      Log out
                    </Button>
                  </form>
                )}
              </SheetContent>
            </Sheet>
            </div>
          </div>

          <nav
            className="flex items-center rounded-md bg-card p-2.5 shadow-[0_0_1px_0_hsl(var(--foreground)/0.3),0_4px_8px_0_hsl(var(--foreground)/0.1)]"
            aria-label="Main"
          >
            {MOBILE_NAV_LINKS.map(({ href, label, image }, index) => {
              const active = index === activeMobileIndex;
              return (
                <Fragment key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    title={active ? undefined : label}
                    className={cn(
                      "flex min-h-11 min-w-[44px] items-center justify-center gap-2 whitespace-nowrap rounded px-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active ? "flex-[2] bg-accent font-medium text-foreground" : "flex-1 text-foreground",
                    )}
                  >
                    <Image src={`/images/navigation/${image}.svg`} width={20} height={20} alt="" className="shrink-0 dark:invert" />
                    <span className={active ? undefined : "sr-only"}>{label}</span>
                  </Link>
                  {index < MOBILE_NAV_LINKS.length - 1 && (
                    <Image
                      src="/images/navigation/separator.svg"
                      width={1}
                      height={20}
                      alt=""
                      className={cn("mx-1.5 shrink-0 dark:invert", (active || activeMobileIndex === index + 1) && "invisible")}
                    />
                  )}
                </Fragment>
              );
            })}
          </nav>
        </header>

        {/* Page content */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
