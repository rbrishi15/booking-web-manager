import { BookingLogo } from "@/components/ui/booking-logo";

/** Shared desktop identity for the discovery page and its route fallbacks. */
export function DiscoveryHero() {
  return (
    <header className="hidden min-h-[208px] flex-col justify-center pb-8 pt-10 md:flex lg:min-h-[224px]">
      <h1><BookingLogo className="text-5xl lg:text-6xl" /></h1>
      <p className="mt-3 max-w-md text-base leading-relaxed text-muted-foreground lg:text-lg">
        Find your next game. Make time to play.
      </p>
    </header>
  );
}
