import { Crop, RotateCcw } from 'lucide-react';
import { RESIZE_PRESETS, type ResizePreset } from '../../constants/resizePresets';
import { useCapabilitiesStore } from '../../store/capabilitiesStore';
import { useResizeSettingsStore } from '../../store/resizeSettingsStore';
import type { ResizeFormat, ResizePresetId } from '../../types/resize';
import { cn } from '../../utils/cn';
import { Button } from '../common/Button';
import { NumberField } from '../common/NumberField';
import { SegmentedControl } from '../common/SegmentedControl';
import { TargetSizeField } from './TargetSizeField';

const GROUPS: ResizePreset['group'][] = ['Documents', 'Social media'];

function PresetOption({
  id,
  name,
  detail,
  size,
  active,
  onSelect,
}: {
  id: ResizePresetId;
  name: string;
  detail: string;
  size: string | null;
  active: boolean;
  onSelect: (id: ResizePresetId) => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        active ? 'border-accent bg-accent-soft/60' : 'border-border hover:border-border-strong hover:bg-surface-2/60',
      )}
    >
      <input type="radio" name="resize-preset" value={id} checked={active} onChange={() => onSelect(id)} className="sr-only" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg">{name}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
      {size && <span className="tabular shrink-0 font-mono text-xs text-muted">{size}</span>}
    </label>
  );
}

export function ResizeSettingsPanel() {
  const settings = useResizeSettingsStore();
  const webp = useCapabilitiesStore((s) => s.image.webp);
  const ready = useCapabilitiesStore((s) => s.ready);
  const select = (preset: ResizePresetId) => settings.update({ preset });

  const formats: { value: ResizeFormat; label: string }[] = [
    { value: 'jpeg', label: 'JPG' },
    { value: 'png', label: 'PNG' },
    ...(ready && !webp ? [] : [{ value: 'webp' as const, label: 'WebP' }]),
  ];

  return (
    <section aria-labelledby="resize-settings-title" className="card p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 id="resize-settings-title" className="text-sm font-semibold text-fg">
          Resize settings
        </h2>
        <Button variant="ghost" size="sm" onClick={settings.reset} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
          Reset
        </Button>
      </div>

      <fieldset className="space-y-4">
        <legend className="sr-only">Output size</legend>
        <PresetOption
          id="freehand"
          name="Freehand"
          detail="Crop any rectangle, keeps full resolution"
          size={null}
          active={settings.preset === 'freehand'}
          onSelect={select}
        />
        {GROUPS.map((group) => (
          <div key={group}>
            <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{group}</p>
            <div className="grid gap-1.5">
              {RESIZE_PRESETS.filter((p) => p.group === group).map((p) => (
                <PresetOption
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  detail={p.detail}
                  size={`${p.width} × ${p.height}`}
                  active={settings.preset === p.id}
                  onSelect={select}
                />
              ))}
            </div>
          </div>
        ))}
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Other</p>
          <PresetOption
            id="custom"
            name="Custom size"
            detail="Any width and height, in pixels"
            size={null}
            active={settings.preset === 'custom'}
            onSelect={select}
          />
          {settings.preset === 'custom' && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumberField
                label="Width"
                suffix="px"
                value={settings.customWidth}
                onChange={(w) => settings.update({ customWidth: w ?? 1 })}
              />
              <NumberField
                label="Height"
                suffix="px"
                value={settings.customHeight}
                onChange={(h) => settings.update({ customHeight: h ?? 1 })}
              />
            </div>
          )}
        </div>
      </fieldset>

      <div className="my-5 h-px bg-border" />

      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-muted uppercase">Format</span>
          <SegmentedControl label="Output format" size="sm" value={settings.format} onChange={(format) => settings.update({ format })} segments={formats} />
        </div>
        <TargetSizeField
          value={settings.targetKB}
          onChange={(targetKB) => settings.update({ targetKB })}
          hint="The pixel size stays exact; only quality is lowered until the file fits. PNG is saved as JPG on a white background, since PNG can't hit an exact size."
        />
        <p className="flex gap-2 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-xs text-muted">
          <Crop className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {settings.preset === 'freehand'
              ? 'Press the crop button on a photo and drag any edge or corner to choose what to keep. Until then, the whole photo is kept.'
              : 'The center of each photo is used by default. Press the crop button on a photo to choose exactly what to keep.'}
          </span>
        </p>
      </div>
    </section>
  );
}
