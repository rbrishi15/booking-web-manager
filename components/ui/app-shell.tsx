"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
  { href: "/discover", label: "Home", letter: "H" }, 
  { href: "/sessions", label: "My sessions", letter: "S" }, 
  { href: "/wallet", label: "Wallet", letter: "W" }, 
  { href: "/groups", label: "Groups", letter: "G" }, 
  { href: "/profile", label: "Settings", letter: "P" }, 
] as const;


const CREATE_SESSION_HREF = "/sessions/new";

export interface ShellUser {
  readonly name: string;
  
  readonly reliabilityScore: number;
}

interface AppShellProps {
  readonly user: ShellUser;
  
  readonly logoutAction?: () => Promise<void>;
  readonly children: React.ReactNode;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}


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
    <div className="flex h-full flex-col gap-6 p-5">
      {/* Logo */}
      <Link href="/discover" onClick={onNavigate} className="text-2xl font-bold tracking-tight">
        Booking.
      </Link>

      {/* + Create session */}
      <Button asChild className="w-full">
        <Link href={CREATE_SESSION_HREF} onClick={onNavigate}>
          + Create session
        </Link>
      </Button>

      {/* Navigation links */}
      <nav className="flex flex-col gap-1" aria-label="Main">
        {NAV_LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
                active && "bg-accent font-medium",
              )}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded border bg-card text-xs font-semibold text-muted-foreground">
                {link.letter}
              </span>
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Your account (bottom) */}
      <div className="mt-auto border-t pt-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
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
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Log out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}


export function AppShell({ user, logoutAction, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar (hidden below 768px) */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r bg-card md:block">
        <SidebarContents user={user} logoutAction={logoutAction} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
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