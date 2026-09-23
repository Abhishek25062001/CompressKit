import { ChevronDown } from 'lucide-react';
import { useId } from 'react';

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SelectProps<T extends string | number> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  hint?: string;
}

export function Select<T extends string | number>({ label, value, options, onChange, hint }: SelectProps<T>) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={String(value)}
          onChange={(e) => {
            const match = options.find((o) => String(o.value) === e.target.value);
            if (match) onChange(match.value);
          }}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="h-10 w-full appearance-none rounded-xl border border-border bg-surface px-3 pr-9 text-sm text-fg transition-colors hover:border-border-strong focus-visible:border-accent"
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-muted" />
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
