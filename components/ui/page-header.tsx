interface PageHeaderProps {

  readonly breadcrumb?: string;
  readonly title: string;

  readonly actions?: React.ReactNode;
}


export function PageHeader({ breadcrumb, title, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b bg-card px-4 py-5 md:px-8 md:py-6">
      <div>
        {breadcrumb !== undefined && (
          <p className="text-sm text-muted-foreground">{breadcrumb}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      {actions !== undefined && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}