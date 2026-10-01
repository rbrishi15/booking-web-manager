"use client";

import { LogOut, Menu, UsersRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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

const NAV_LINKS = [
  { href: "/discover", label: "Home", image: "home" },
  { href: "/sessions", label: "My sessions", image: "sessions" },
  { href: "/wallet", label: "Wallet", image: "wallet" },
  { href: "/groups", label: "Groups", image: null },
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
}


/** Renders active-route navigation and account details, with optional logout and navigation callbacks. */
function SidebarContents({
  user,
  logoutAction,
  onNavigate,
}: {
  readonly user: ShellUser;
  readonly logoutAction?: () => Promise<void>;
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 py-7 lg:px-5 lg:py-8">
      <div className="px-3">
        <Link
          href="/discover"
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
              href={link.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] items-center gap-3 rounded-lg px-3 py-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:gap-4",
                active && "bg-accent font-semibold",
              )}
            >
              {link.image === null ? (
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


/** Frames page content with a desktop sidebar and a mobile menu that closes on navigation. */
export function AppShell({ user, logoutAction, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar (hidden below 768px) */}
      <aside className="sticky top-4 my-4 ml-4 hidden h-[calc(100dvh-2rem)] w-52 shrink-0 rounded-2xl border border-border/40 bg-card shadow-[0_8px_32px_-16px_hsl(var(--foreground)/0.08)] md:block lg:w-60 2xl:w-64">
        <SidebarContents user={user} logoutAction={logoutAction} />
      </aside>

      <div className="relative isolate flex min-w-0 flex-1 flex-col">
        {/* The desktop court fades behind the page introduction without competing with its content. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-[420px] overflow-hidden md:block" aria-hidden="true">
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
        {/* Phone top bar (hidden from 768px up) */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
          <Link href="/discover" className="text-xl font-bold tracking-tight">
            Booking.
          </Link>
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Main menu</SheetTitle>
              <SheetDescription className="sr-only">Navigate between pages</SheetDescription>
              <SidebarContents
                user={user}
                logoutAction={logoutAction}
                onNavigate={() => setMenuOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </div>

        {/* Page content */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}