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
  { value: 2, label: 'Tight (2 px)' },
  { value: 4, label: 'Balanced (4 px)' },
  { value: 8, label: 'Wide (8 px)' },
  { value: 14, label: 'Extra (14 px)' },
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
          hint="Keep this small so borders next to the mark are not filled over."
        />

        <div className="space-y-2 border-t border-border pt-4 text-xs text-muted">
          <p className="flex gap-2">
            <Eraser className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Press <span className="font-medium text-fg">Mark watermark</span>, cover only the logo or text (not nearby
              lines), then remove. The fill copies texture from around the mark. Your photos never leave this device.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
