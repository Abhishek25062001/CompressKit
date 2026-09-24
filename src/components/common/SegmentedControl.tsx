import { useEffect, useRef, type ReactNode } from 'react';
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
  /** 'tabs' is 'md' with tighter spacing on phones, for the workspace's tool switcher. */
  size?: 'sm' | 'md' | 'tabs';
}

/** A group of toggle buttons with aria-pressed; arrow keys are not required since each is tabbable. */
export function SegmentedControl<T extends string>({ value, segments, onChange, label, size = 'md' }: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);
  // In a row that scrolls sideways, keep the chosen tab in view (it may have been opened by a link).
  useEffect(() => {
    const group = groupRef.current;
    if (size !== 'tabs' || !group || group.scrollWidth <= group.clientWidth) return;
    const active = group.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (active) group.scrollTo({ left: active.offsetLeft - (group.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
  }, [value, size]);

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={label}
      className={cn(
        'inline-flex rounded-xl border border-border bg-surface-2 p-0.5',
        // The tool switcher scrolls sideways on the narrowest phones instead of overflowing the page.
        size === 'tabs' && 'max-w-full overflow-x-auto [scrollbar-width:none]',
      )}
    >
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
              size === 'sm' ? 'h-7 min-w-7 px-2 text-xs' : size === 'tabs' ? 'h-8 shrink-0 px-1.5 text-[13px] sm:px-3 sm:text-sm' : 'h-8 px-3 text-sm',
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
