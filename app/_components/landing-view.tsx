import { ArrowRight, BookOpen, Code2, LayoutGrid } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { BookingLogo } from "@/components/ui/booking-logo";
import { Button } from "@/components/ui/button";

/** Public and synchronous: the landing never depends on authentication or session data. */
export function LandingView() {
  return (
    <main className="relative isolate min-h-screen bg-background px-6 py-8 md:px-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] overflow-hidden" aria-hidden="true">
        <Image src="/images/mobile-hero.png" alt="" fill sizes="100vw" className="object-cover object-right-top opacity-35 dark:opacity-15" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 to-background" />
      </div>
      <div className="mx-auto max-w-5xl">
        <header className="flex min-h-11 items-center justify-between gap-4">
          <Link href="/" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><BookingLogo /></Link>
          <Button asChild variant="outline" className="min-h-11"><Link href="/login">Log in</Link></Button>
        </header>
        <section className="max-w-2xl pb-16 pt-20 md:pb-24 md:pt-28">
          <p className="mb-4 text-sm font-medium text-muted-foreground">Make time for play.</p>
          <h1 className="text-4xl font-black tracking-tight md:text-6xl">Find your next game.</h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground md:text-lg">Discover public sports sessions, find a court near you, and get back to the games you love.</p>
          <Button asChild className="mt-8 min-h-11"><Link href="/register">Create account<ArrowRight aria-hidden /></Link></Button>
        </section>
        <section aria-labelledby="resources-title" className="pb-10">
          <h2 id="resources-title" className="text-xl font-semibold">Explore the project</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {[
              { href: "/api-docs", title: "API docs", description: "Explore and try the Booking API.", icon: BookOpen },
              { href: "/api/openapi", title: "OpenAPI", description: "Read the API specification.", icon: Code2 },
              { href: "/storybook", title: "Storybook", description: "Explore components and page states.", icon: LayoutGrid },
            ].map(({ href, title, description, icon: Icon }) => (
              <Link key={href} href={href} prefetch={false} className="group rounded-xl border bg-card p-6 shadow-sm outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring">
                <Icon className="mb-5 h-5 w-5" aria-hidden />
                <h3 className="flex items-center justify-between font-semibold">{title}<ArrowRight className="h-4 w-4" aria-hidden /></h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
