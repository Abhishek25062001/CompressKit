import { useCapabilitiesStore } from '../../store/capabilitiesStore';
import type { ImageOutputFormat, ImageSettings } from '../../types/settings';
import { NumberField } from '../common/NumberField';
import { Select, type SelectOption } from '../common/Select';
import { Slider } from '../common/Slider';
import { Switch } from '../common/Switch';

interface Props {
  value: ImageSettings;
  onChange: (patch: Partial<ImageSettings>) => void;
}

function qualityHint(format: ImageOutputFormat, quality: number): string {
  if (format === 'png') {
    return quality >= 90 ? 'PNG is saved losslessly at 90 and above.' : 'PNG is reduced to an optimized color palette.';
  }
  return 'Higher keeps more detail. 75 to 85 is usually indistinguishable from the original.';
}

export function ImageSettingsForm({ value, onChange }: Props) {
  const caps = useCapabilitiesStore((s) => s.image);
  const ready = useCapabilitiesStore((s) => s.ready);

  const formats: SelectOption<ImageOutputFormat>[] = [
    { value: 'original', label: 'Same as original' },
    { value: 'webp', label: ready && !caps.webp ? 'WebP (not supported here)' : 'WebP', disabled: ready && !caps.webp },
    { value: 'avif', label: caps.avifNative ? 'AVIF' : 'AVIF (WebAssembly, slower)' },
    { value: 'jpeg', label: 'JPEG' },
    { value: 'png', label: 'PNG' },
  ];

  return (
    <div className="space-y-5">
      <Select
        label="Output format"
        value={value.format}
        options={formats}
        onChange={(format) => onChange({ format })}
        hint="Transparent images are never flattened into JPEG. They are kept as WebP or PNG."
      />
      <Slider
        label="Quality"
        min={1}
        max={100}
        value={value.quality}
        onChange={(quality) => onChange({ quality })}
        hint={qualityHint(value.format, value.quality)}
      />
      <Switch
        label="Preserve resolution"
        description="Keep the original pixel dimensions."
        checked={value.preserveResolution}
        onChange={(preserveResolution) => onChange({ preserveResolution })}
      />
      {!value.preserveResolution && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Max width"
            suffix="px"
            placeholder="Any"
            value={value.maxWidth}
            onChange={(maxWidth) => onChange({ maxWidth })}
          />
          <NumberField
            label="Max height"
            suffix="px"
            placeholder="Any"
            value={value.maxHeight}
            onChange={(maxHeight) => onChange({ maxHeight })}
          />
          <p className="col-span-2 -mt-1 text-xs text-muted">Images are scaled down to fit, keeping their aspect ratio. Smaller images are never enlarged.</p>
        </div>
      )}
    </div>
  );
}
