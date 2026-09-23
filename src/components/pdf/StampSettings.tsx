import { ImagePlus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { signatureFromImage } from '../../features/pdf/signature';
import { usePdfSettingsStore, usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { NumberFormat, NumberPosition } from '../../types/pdf';
import { Button } from '../common/Button';
import { NumberField } from '../common/NumberField';
import { SegmentedControl } from '../common/SegmentedControl';
import { Select } from '../common/Select';
import { Slider } from '../common/Slider';
import { Switch } from '../common/Switch';

const POSITIONS: { value: NumberPosition; label: string }[] = [
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
];

const FORMATS: { value: NumberFormat; label: string }[] = [
  { value: 'page-n-of-total', label: 'Page 1 of 5' },
  { value: 'page-n', label: 'Page 1' },
  { value: 'n-slash-total', label: '1 / 5' },
  { value: 'n', label: '1' },
];

/** Page numbers and a watermark, added to every PDF the tool writes (save, split and compress). */
export function StampSettings() {
  const numbers = usePdfSettingsStore((s) => s.pageNumbers);
  const watermark = usePdfSettingsStore((s) => s.watermark);
  const update = usePdfSettingsStore((s) => s.update);
  const setNumbers = (patch: Partial<typeof numbers>) => update({ pageNumbers: { ...numbers, ...patch } });
  const setWatermark = (patch: Partial<typeof watermark>) => update({ watermark: { ...watermark, ...patch } });
  const textId = useId();
  const logoId = useId();
  const logo = usePdfStore((s) => s.watermarkLogo);
  const setLogo = usePdfStore((s) => s.setWatermarkLogo);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [loading, setLoading] = useState(false);
  const kind = watermark.kind ?? 'text';

  const uploadLogo = async (file: File) => {
    setLoading(true);
    try {
      const asset = await signatureFromImage(file, removeWhite);
      if (asset) setLogo(asset);
    } catch {
      useUiStore.getState().pushNotice({ tone: 'error', title: "We couldn't read that image", message: 'Try a PNG or JPG logo.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface-2/40 p-3">
      <p className="text-xs font-medium text-fg">Add to every page</p>
      <Switch
        label="Page numbers"
        description="Numbered in the order of the file you download."
        checked={numbers.enabled}
        onChange={(enabled) => setNumbers({ enabled })}
      />
      {numbers.enabled && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Select label="Position" value={numbers.position} options={POSITIONS} onChange={(position) => setNumbers({ position })} />
            <Select label="Style" value={numbers.format} options={FORMATS} onChange={(format) => setNumbers({ format })} />
          </div>
          <NumberField label="Start at" value={numbers.start} onChange={(start) => setNumbers({ start: start ?? 1 })} />
          <Switch
            label="Skip the first page"
            description="For a cover page. Numbering still counts it."
            checked={numbers.skipFirst}
            onChange={(skipFirst) => setNumbers({ skipFirst })}
          />
        </div>
      )}

      <div className="h-px bg-border" />

      <Switch
        label="Watermark"
        description="Faint text or a logo across the middle of each page."
        checked={watermark.enabled}
        onChange={(enabled) => setWatermark({ enabled })}
      />
      {watermark.enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Type</span>
            <SegmentedControl
              label="Watermark type"
              size="sm"
              value={kind}
              onChange={(v) => setWatermark({ kind: v })}
              segments={[
                { value: 'text', label: 'Text' },
                { value: 'logo', label: 'Logo' },
              ]}
            />
          </div>
          {kind === 'text' ? (
            <div>
              <label htmlFor={textId} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
                Text
              </label>
              <input
                id={textId}
                value={watermark.text}
                maxLength={60}
                onChange={(e) => setWatermark({ text: e.target.value })}
                placeholder="e.g. CONFIDENTIAL, DRAFT, COPY"
                className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle hover:border-border-strong focus-visible:border-accent"
              />
            </div>
          ) : logo ? (
            <div className="flex items-center gap-3">
              <div className="checkerboard flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border border-border p-1.5">
                <img src={logo.url} alt="Watermark logo" className="max-h-full max-w-full object-contain" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setLogo(null)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
                Remove logo
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Switch
                label="Remove white background"
                description="For a logo on white. Transparent PNGs need nothing."
                checked={removeWhite}
                onChange={setRemoveWhite}
              />
              <input
                id={logoId}
                type="file"
                accept="image/*,.heic,.heif"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void uploadLogo(file);
                }}
              />
              <label
                htmlFor={logoId}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong/80 px-4 py-4 text-sm text-muted transition-colors hover:border-accent/60 hover:text-fg"
              >
                <ImagePlus className="h-4 w-4" aria-hidden />
                {loading ? 'Preparing…' : 'Choose a logo image'}
              </label>
              <p className="text-xs text-muted">The logo stays in this tab only and is never saved.</p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Size</span>
            <SegmentedControl
              label="Watermark size"
              size="sm"
              value={watermark.size}
              onChange={(size) => setWatermark({ size })}
              segments={[
                { value: 'small', label: 'Small' },
                { value: 'medium', label: 'Medium' },
                { value: 'large', label: 'Large' },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Angle</span>
            <SegmentedControl
              label="Watermark angle"
              size="sm"
              value={watermark.diagonal ? 'diagonal' : 'straight'}
              onChange={(v) => setWatermark({ diagonal: v === 'diagonal' })}
              segments={[
                { value: 'diagonal', label: 'Diagonal' },
                { value: 'straight', label: 'Straight' },
              ]}
            />
          </div>
          <Slider
            label="Strength"
            min={5}
            max={50}
            value={Math.round(watermark.opacity * 100)}
            onChange={(v) => setWatermark({ opacity: v / 100 })}
            format={(v) => `${v}%`}
          />
        </div>
      )}
    </div>
  );
}
