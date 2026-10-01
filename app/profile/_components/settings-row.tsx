import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface SettingsRowProps {
  /** Two letters in the grey circle, e.g. "EP" (mockup 10). */
  readonly code: string;
  readonly title: string;
  readonly description?: string;
  /** Where the row goes. Without it, the row shows "Coming soon" and can't be clicked. */
  readonly href?: string;
  readonly tone?: "default" | "danger";
}

/** One row in a Settings list (mockup 10), e.g. "EP  Edit profile  >". */
export function SettingsRow({ code, title, description, href, tone = "default" }: SettingsRowProps) {
  const danger = tone === "danger";
  const content = (
    <>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold text-muted-foreground"
        aria-hidden
      >
        {code}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block font-medium", danger && "text-destructive")}>{title}</span>
        {description !== undefined && (
          <span className="block truncate text-sm text-muted-foreground">{description}</span>
        )}
      </span>
      {href !== undefined ? (
        <ChevronRight className={cn("h-4 w-4 shrink-0", danger && "text-destructive")} aria-hidden />
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">Coming soon</span>
      )}
    </>
  );

  const rowClassName = cn(
    "flex items-center gap-3 px-4 py-3",
    danger && "bg-destructive/5",
  );

  if (href === undefined) return <div className={cn(rowClassName, "opacity-70")}>{content}</div>;

  return (
    <Link
      href={href}
      className={cn(
        rowClassName,
        "transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        danger && "hover:bg-destructive/10",
      )}
    >
      {content}
    </Link>
  );
}