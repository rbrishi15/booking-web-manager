import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface InfoNoteProps {
  readonly children: React.ReactNode;

  readonly icon?: boolean;
  readonly className?: string;
}


export function InfoNote({ children, icon = false, className }: InfoNoteProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-l-4 border-info bg-info-muted/70 px-4 py-3 text-sm text-foreground/80",
        className,
      )}
    >
      {icon && <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />}
      <div>{children}</div>
    </div>
  );
}