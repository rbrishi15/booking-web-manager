import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BookingLogo } from "@/components/ui/booking-logo";

interface AuthFrameProps {
  /** Grey text in the top bar, e.g. "New to Booking.?" */
  readonly prompt: string;
  /** Button in the top bar, e.g. "Create account". */
  readonly switchLabel: string;
  readonly switchHref: string;
  /** The grey panel on the left (hidden on phones). */
  readonly panel: React.ReactNode;
  /** The form side on the right. */
  readonly children: React.ReactNode;
}

/** Top bar + two columns shared by the register and log-in pages (mockups 02, 03). */
export function AuthFrame({ prompt, switchLabel, switchHref, panel, children }: AuthFrameProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-4 md:px-10">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <BookingLogo />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{prompt}</span>
          <Button asChild variant="outline" size="sm">
            <Link href={switchHref}>{switchLabel}</Link>
          </Button>
        </div>
      </header>

      <main className="grid flex-1 gap-8 p-4 md:grid-cols-2 md:p-10">
        <div className="hidden md:block">{panel}</div>
        <div className="flex items-center justify-center py-6">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}

interface AuthPanelProps {
  /** Small blue capitals, e.g. "WELCOME BACK". */
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  /** Optional content pinned to the bottom of the panel. */
  readonly footer?: React.ReactNode;
}

/** The grey marketing panel on the left of the register and log-in pages. */
export function AuthPanel({ eyebrow, title, description, footer }: AuthPanelProps) {
  return (
    <section className="flex h-full flex-col justify-between gap-10 rounded-xl border bg-secondary p-10 lg:p-12">
      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-info">{eyebrow}</p>
        <h2 className="text-4xl font-bold tracking-tight lg:text-5xl">{title}</h2>
        <p className="text-lg text-muted-foreground">{description}</p>
      </div>
      {footer}
    </section>
  );
}

interface AuthHeadingProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
}

/** The label, title and helper text above each form, e.g. "ACCOUNT ACCESS / Log in". */
export function AuthHeading({ eyebrow, title, description }: AuthHeadingProps) {
  return (
    <div className="mb-8 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-info">{eyebrow}</p>
      <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}
