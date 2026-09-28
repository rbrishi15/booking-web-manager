import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorMessageProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}


/** Displays an error with alert semantics so assistive technology can announce it. */
export function ErrorMessage({ children, className }: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}