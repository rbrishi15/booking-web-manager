import { cn } from "@/lib/utils";

interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;

  readonly action?: React.ReactNode;
  readonly className?: string;
}


/** Renders an empty-content placeholder with an optional description and action. */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      {description !== undefined && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}