import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import { NumberField } from '../common/NumberField';
import { Switch } from '../common/Switch';

/** Common limits on job, exam and government upload forms. */
const TARGET_PRESETS_KB = [20, 50, 100, 200, 500];
const DEFAULT_TARGET_KB = 100;

interface TargetSizeFieldProps {
  value: number | null;
  onChange: (targetKB: number | null) => void;
  /** Explains how the limit is reached, shown while it is on. */
  hint: ReactNode;
}

/** A "Target file size" switch with a KB field and one-tap common limits. */
export function TargetSizeField({ value, onChange, hint }: TargetSizeFieldProps) {
  return (
    <>
      <Switch
        label="Target file size"
        description="Shrink each image to fit a size limit, like upload forms ask for."
        checked={!!value}
        onChange={(on) => onChange(on ? DEFAULT_TARGET_KB : null)}
      />
      {value ? (
        <div className="space-y-3">
          <NumberField
            label="Maximum size"
            suffix="KB"
            placeholder="100"
            value={value}
            onChange={(kb) => onChange(kb ?? DEFAULT_TARGET_KB)}
          />
          <div role="group" aria-label="Common size limits" className="flex flex-wrap gap-1.5">
            {TARGET_PRESETS_KB.map((kb) => (
              <button
                key={kb}
                type="button"
                aria-pressed={value === kb}
                onClick={() => onChange(kb)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 font-mono text-xs font-medium transition-colors',
                  value === kb ? 'border-accent/50 bg-accent-soft text-accent-text' : 'border-border bg-surface-2 text-muted hover:text-fg',
                )}
              >
                {kb} KB
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{hint}</p>
        </div>
      ) : null}
    </>
  );
}
