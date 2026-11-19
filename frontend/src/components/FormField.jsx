import { useId } from 'react';

export default function FormField({ as: Control = 'input', name, label, error, hint, children, ...props }) {
  const id = useId();
  const descriptions = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ');
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">{label}</label>
      <Control
        {...props}
        id={id}
        name={name}
        required
        aria-invalid={Boolean(error)}
        aria-describedby={descriptions || undefined}
        className={`min-h-11 w-full min-w-0 max-w-full scroll-mt-24 rounded-lg border bg-white px-3 py-2 text-sm text-ink placeholder:text-muted disabled:bg-canvas disabled:text-muted ${error ? 'border-red-400' : 'border-line'}`}
      >
        {children}
      </Control>
      {error && (
        <p id={`${id}-error`} className="mt-1.5 wrap-anywhere text-sm text-red-700">{error}</p>
      )}
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 wrap-anywhere text-xs leading-5 text-muted">{hint}</p>
      )}
    </div>
  );
}
