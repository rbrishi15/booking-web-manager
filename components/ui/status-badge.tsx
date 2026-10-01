import { cn } from "@/lib/utils";

const tones = {
  success: "bg-success-muted text-success",      // "Confirmed", "Joined"
  info: "bg-info-muted text-info",               // "Hosting", "Waitlist", "2 slots left", "Owner"
  neutral: "bg-secondary text-muted-foreground", // "Completed", "Archived"
  danger: "bg-destructive/10 text-destructive",  // "Removed", "Forfeited"
} as const;

export type StatusTone = keyof typeof tones;

interface StatusBadgeProps {
  readonly tone: StatusTone;
  readonly children: React.ReactNode;
  readonly className?: string;
}

/** A small coloured pill for statuses, matching the SRS mockups. */
export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}