import { Gauge, Scale, Sparkles, type LucideIcon } from 'lucide-react';
import { PRESETS } from '../../constants/presets';
import type { PresetId } from '../../types/settings';
import { cn } from '../../utils/cn';

const ICONS: Record<PresetId, LucideIcon> = {
  'max-quality': Sparkles,
  balanced: Scale,
  'max-compression': Gauge,
};

interface PresetPickerProps {
  value: PresetId | null;
  onChange: (id: PresetId) => void;
  name: string;
}

export function PresetPicker({ value, onChange, name }: PresetPickerProps) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">
        Preset {value === null && <span className="ml-1 normal-case tracking-normal text-subtle">(custom values)</span>}
      </legend>
      <div className="grid gap-2">
        {PRESETS.map((p) => {
          const Icon = ICONS[p.id];
          const active = value === p.id;
          return (
            <label
              key={p.id}
              className={cn(
                'relative flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                active ? 'border-accent bg-accent-soft/60' : 'border-border hover:border-border-strong hover:bg-surface-2/60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={p.id}
                checked={active}
                onChange={() => onChange(p.id)}
                className="sr-only"
              />
              <span
                className={cn(
                  'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  active ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  {p.name}
                  {p.id === 'balanced' && (
                    <span className="rounded-full bg-surface-3 px-1.5 py-px text-[10px] font-medium tracking-wide text-muted uppercase">
                      Default
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{p.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
