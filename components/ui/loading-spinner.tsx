import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  readonly label?: string;
  readonly className?: string;
}


export function LoadingSpinner({ label = "Loading…", className }: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      className={cn("flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground", className)}
    >
      <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden />
      {label}
    </div>
  );
}