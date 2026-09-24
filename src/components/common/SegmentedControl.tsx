import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  segments: Segment<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}

/** A group of toggle buttons with aria-pressed; arrow keys are not required since each is tabbable. */
export function SegmentedControl<T extends string>({ value, segments, onChange, label, size = 'md' }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border border-border bg-surface-2 p-0.5">
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={active}
            aria-label={s.ariaLabel}
            title={s.ariaLabel}
            onClick={() => onChange(s.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-all',
              size === 'sm' ? 'h-7 min-w-7 px-2 text-xs' : 'h-8 px-3 text-sm',
              active ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg',
            )}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
