import { useId } from 'react';

interface NumberFieldProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  suffix?: string;
}

export function NumberField({ label, value, onChange, placeholder, suffix }: NumberFieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={20000}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            onChange(Number.isFinite(n) && n > 0 ? Math.min(n, 20000) : null);
          }}
          className="tabular h-10 w-full rounded-xl border border-border bg-surface px-3 pr-10 text-sm text-fg placeholder:text-subtle hover:border-border-strong focus-visible:border-accent"
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
      </div>
    </div>
  );
}
