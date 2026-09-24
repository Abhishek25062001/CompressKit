import { AlertTriangle, Cpu, Download, RotateCcw, Zap } from 'lucide-react';
import { useId } from 'react';
import { MODEL_BYTES } from '../../features/background/backgroundManager';
import { useBackgroundSettingsStore } from '../../store/backgroundSettingsStore';
import type { CutoutBackground, CutoutFormat } from '../../types/background';
import { formatBytes } from '../../utils/format';
import { Button } from '../common/Button';
import { SegmentedControl } from '../common/SegmentedControl';
import { Select, type SelectOption } from '../common/Select';
import { Switch } from '../common/Switch';

/** WebGPU runs the model on the graphics card; without it the processor takes about a minute per photo. */
const HAS_WEBGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

export function BackgroundSettingsPanel() {
  const settings = useBackgroundSettingsStore();
  const colorId = useId();
  const transparent = settings.background === 'transparent';

  const formats: SelectOption<CutoutFormat>[] = [
    { value: 'png', label: 'PNG · lossless' },
    { value: 'webp', label: 'WebP · smaller' },
    { value: 'jpeg', label: transparent ? 'JPG (needs a background colour)' : 'JPG · smallest', disabled: transparent },
  ];

  return (
    <section aria-labelledby="background-settings-title" className="card p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 id="background-settings-title" className="text-sm font-semibold text-fg">
          Cut-out settings
        </h2>
        <Button variant="ghost" size="sm" onClick={settings.reset} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
          Reset
        </Button>
      </div>

      <div className="space-y-5">
        <div>
          <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">New background</span>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl<CutoutBackground>
              label="New background"
              size="sm"
              value={settings.background}
              onChange={(background) => settings.update({ background })}
              segments={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'white', label: 'White' },
                { value: 'color', label: 'Colour' },
              ]}
            />
            {settings.background === 'color' && (
              <label htmlFor={colorId} className="inline-flex items-center gap-2 text-xs text-muted">
                <input
                  id={colorId}
                  type="color"
                  value={settings.color}
                  onChange={(e) => settings.update({ color: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded-lg border border-border bg-surface p-0.5"
                />
                <span className="font-mono uppercase">{settings.color}</span>
              </label>
            )}
          </div>
        </div>

        <Select
          label="Save as"
          value={settings.format}
          options={formats}
          onChange={(format) => settings.update({ format })}
          hint={transparent ? 'PNG and WebP keep the transparency.' : undefined}
        />

        <Switch
          label="Crop to the subject"
          checked={settings.trim}
          onChange={(trim) => settings.update({ trim })}
          description="Removes the empty space around the cut-out, for stickers and product photos."
        />

        <div className="space-y-2 border-t border-border pt-4 text-xs text-muted">
          {MODEL_BYTES === null ? (
            <p className="flex gap-2 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              This copy of CompressKit was built without the AI model, so the background remover is unavailable.
            </p>
          ) : (
            <p className="flex gap-2">
              <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                The first photo downloads a {formatBytes(MODEL_BYTES, 0)} AI model from this site. It is then kept by your browser, so later photos start
                right away, even offline. Your photos never leave your device.
              </span>
            </p>
          )}
          {HAS_WEBGPU ? (
            <p className="flex gap-2">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />
              Runs on your graphics card: about a second per photo.
            </p>
          ) : (
            <p className="flex gap-2 text-warning">
              <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              This browser has no WebGPU, so the model runs on the processor: about a minute per photo. Recent Chrome, Edge or Safari are much faster.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
