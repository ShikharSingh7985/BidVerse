export function DetailValue({ label, children, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 wrap-anywhere text-sm font-medium">{children}</dd>
    </div>
  );
}

export default function DetailsPanel({ title, icon: Icon, children }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border border-line bg-white shadow-sm shadow-slate-950/5">
      <h2 className="flex items-center gap-2.5 border-b border-line px-4 py-4 text-base font-semibold sm:px-5">
        <Icon size={18} strokeWidth={1.8} className="shrink-0 text-accent" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}
