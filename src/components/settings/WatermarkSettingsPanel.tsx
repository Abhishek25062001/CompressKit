import { AlertTriangle, Cpu, Download, Eraser, RotateCcw, Zap } from 'lucide-react';
import { INPAINT_MODEL_BYTES } from '../../features/watermark/watermarkManager';
import { useWatermarkSettingsStore } from '../../store/watermarkSettingsStore';
import type { WatermarkFormat } from '../../types/watermark';
import { formatBytes } from '../../utils/format';
import { Button } from '../common/Button';
import { Select, type SelectOption } from '../common/Select';
import { Switch } from '../common/Switch';

const FORMATS: SelectOption<WatermarkFormat>[] = [
  { value: 'original', label: 'Same as original' },
  { value: 'png', label: 'PNG · lossless' },
  { value: 'webp', label: 'WebP · smaller' },
  { value: 'jpeg', label: 'JPG · smallest' },
];

const EXPAND_OPTIONS: SelectOption<number>[] = [
  { value: 0, label: 'None' },
  { value: 4, label: 'Tight (4 px)' },
  { value: 10, label: 'Default (10 px)' },
  { value: 16, label: 'Wide (16 px)' },
  { value: 24, label: 'Extra (24 px)' },
];

const HAS_WEBGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
/** The model this browser will most likely download on the first photo. */
const MODEL_SIZE = (HAS_WEBGPU ? INPAINT_MODEL_BYTES.gpu : null) ?? INPAINT_MODEL_BYTES.cpu;

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
        <Select label="Save as" value={settings.format} options={FORMATS} onChange={(format) => settings.update({ format })} />

        <Select
          label="Expand mark"
          value={settings.expand}
          options={EXPAND_OPTIONS}
          onChange={(expand) => settings.update({ expand })}
          hint="Extra pixels around your box before soft-glow grow. 10 px suits sparkle stamps."
        />

        <Switch
          label="Debug mask (magenta)"
          checked={settings.debugMask}
          onChange={(debugMask) => settings.update({ debugMask })}
          description="Paint the final mask magenta and skip inpainting so you can check placement."
        />

        <div className="space-y-2 border-t border-border pt-4 text-xs text-muted">
          <p className="flex gap-2">
            <Eraser className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Press <span className="font-medium text-fg">Mark watermark</span>, cover the logo or text, then remove. Soft
              glow around sparkles is grown automatically. Your photos never leave this device.
            </span>
          </p>
          {MODEL_SIZE === null ? (
            <p className="flex gap-2 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              This copy was built without the LaMa model, so a simpler fill is used. Run{' '}
              <span className="font-mono text-fg">npm run model:inpaint</span> and rebuild for AI inpainting.
            </p>
          ) : (
            <p className="flex gap-2">
              <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                The first photo downloads a {formatBytes(MODEL_SIZE, 0)} LaMa model from this site. Progress shows on the
                file card. After that it is kept for offline use.
              </span>
            </p>
          )}
          {MODEL_SIZE !== null &&
            (HAS_WEBGPU ? (
              <p className="flex gap-2">
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Your browser has WebGPU, so the faster graphics-card model is preferred.</span>
              </p>
            ) : (
              <p className="flex gap-2">
                <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>No WebGPU here, so the lighter processor model runs (slower on large marks).</span>
              </p>
            ))}
        </div>
      </div>
    </section>
  );
}
