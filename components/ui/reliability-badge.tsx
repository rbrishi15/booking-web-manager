import { cn } from "@/lib/utils";

/** Converts the 0–100 score from the domain to the 5-point scale in the mockups, e.g. 96 → "4.8". */
export function toFivePoint(score: number): string {
  return (score / 20).toFixed(1);
}

/** Thresholds are placeholders until Rishi confirms them. */
export function reliabilityLabel(score: number): "High" | "Medium" | "Low" {
  if (score >= 90) return "High";
  if (score >= 70) return "Medium";
  return "Low";
}

const labelTone = {
  High: "bg-success-muted text-success",
  Medium: "bg-info-muted text-info",
  Low: "bg-destructive/10 text-destructive",
} as const;

const dotTone = {
  High: "bg-success",
  Medium: "bg-info",
  Low: "bg-destructive",
} as const;

interface ReliabilityBadgeProps {
  /** The score on the domain's 0–100 scale. */
  readonly score: number;
  readonly className?: string;
}

/** Pill showing "● Reliability 4.8 / High" (mockups 10, 11, 12). */
export function ReliabilityBadge({ score, className }: ReliabilityBadgeProps) {
  const label = reliabilityLabel(score);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium",
        labelTone[label],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotTone[label])} aria-hidden />
      Reliability {toFivePoint(score)} / {label}
    </span>
  );
}