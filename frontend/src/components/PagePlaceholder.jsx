export default function PagePlaceholder({ title, icon: Icon, message, children }) {
  return (
    <section aria-labelledby="page-title">
      <title>{title} | BidVerse</title>
      <h1 id="page-title" className="text-3xl font-bold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <div className="mt-7 grid min-h-64 place-items-center rounded-2xl border border-line bg-white p-7 text-center sm:min-h-80">
        <div className="grid max-w-sm justify-items-center gap-4">
          <div className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
            <Icon size={26} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <p className="text-sm leading-6 text-muted">{message}</p>
          {children}
        </div>
      </div>
    </section>
  );
}
