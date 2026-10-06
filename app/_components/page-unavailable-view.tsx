import { Compass, Construction, House } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Props =
  | { readonly kind: "not-found"; readonly signedIn: boolean }
  | { readonly kind: "development"; readonly feature: string };

/** Keeps unavailable destinations readable and offers working ways back into the app. */
export function PageUnavailableView(props: Props) {
  const development = props.kind === "development";
  const signedIn = development || props.signedIn;
  const Icon = development ? Construction : Compass;

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 md:px-10 md:py-16">
      <section aria-labelledby="unavailable-heading" className="mx-auto max-w-xl rounded-xl border bg-card px-6 py-10 text-center shadow-sm md:px-10 md:py-14">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-muted-foreground">
          <Icon className="h-7 w-7" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">{development ? "Coming soon" : "404"}</p>
        <h1 id="unavailable-heading" className="text-3xl font-bold leading-tight tracking-tight">
          {development ? `${props.feature} is under development` : "Page not found"}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {development
            ? "This feature isn't available yet. You can still find and organise sessions while we work on it."
            : "This page doesn't exist or the link has changed. Return to Home to continue."}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild className="min-h-11">
            <Link href="/"><House className="mr-2 h-4 w-4" aria-hidden="true" />Back to Home</Link>
          </Button>
          {signedIn && <Button asChild variant="outline" className="min-h-11"><Link href="/sessions">View my sessions</Link></Button>}
        </div>
      </section>
    </div>
  );
}
