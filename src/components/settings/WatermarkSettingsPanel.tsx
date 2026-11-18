import { Eraser, RotateCcw } from 'lucide-react';
import { useWatermarkSettingsStore } from '../../store/watermarkSettingsStore';
import type { WatermarkFormat } from '../../types/watermark';
import { Button } from '../common/Button';
import { Select, type SelectOption } from '../common/Select';

const FORMATS: SelectOption<WatermarkFormat>[] = [
  { value: 'original', label: 'Same as original' },
  { value: 'png', label: 'PNG · lossless' },
  { value: 'webp', label: 'WebP · smaller' },
  { value: 'jpeg', label: 'JPG · smallest' },
];

const EXPAND_OPTIONS: SelectOption<number>[] = [
  { value: 0, label: 'None' },
  { value: 3, label: 'Tight (3 px)' },
  { value: 6, label: 'Balanced (6 px)' },
  { value: 12, label: 'Wide (12 px)' },
  { value: 20, label: 'Extra (20 px)' },
];

export function WatermarkSettingsPanel() {
  const settings = useWatermarkSettingsStore();

  return (
    <section aria-labelledby="watermark-settings-title" className="card p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 id="watermark-settings-title" className="text-sm font-semibold text-fg">
          Watermark settings
        </h2>
        <Button variant="ghost" size="sm" onClick={settings.reset} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
          Reset
        </Button>
      </div>

      <div className="space-y-5">
        <Select
          label="Save as"
          value={settings.format}
          options={FORMATS}
          onChange={(format) => settings.update({ format })}
        />

        <Select
          label="Expand mark"
          value={settings.expand}
          options={EXPAND_OPTIONS}
          onChange={(expand) => settings.update({ expand })}
          hint="A little extra around the box helps blend hard logo edges."
        />

        <div className="space-y-2 border-t border-border pt-4 text-xs text-muted">
          <p className="flex gap-2">
            <Eraser className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Press <span className="font-medium text-fg">Mark watermark</span> on each photo, cover the logo or text, then
              remove. Corner logos and small stamps work best. Your photos never leave this device.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
