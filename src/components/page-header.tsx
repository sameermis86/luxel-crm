/** The one page header pattern: eyebrow, serif title, a line of context, actions on the right. */
export function PageHeader({ eyebrow, title, description, actions, children }: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 lg:mb-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="text-[28px] sm:text-[34px]">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-[15px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Section heading inside a card or page. */
export function SectionTitle({ title, note, actions }: { title: React.ReactNode; note?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2.5">
        <h2 className="text-[19px]">{title}</h2>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      {actions}
    </div>
  );
}
