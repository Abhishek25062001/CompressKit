import { Film, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { VIDEO_TARGET_LABEL } from '../../features/convert/convertJob';
import { useCapabilitiesStore } from '../../store/capabilitiesStore';
import { useConvertSettingsStore } from '../../store/convertSettingsStore';
import type { ConvertImageTarget, ConvertVideoTarget, GifWidth } from '../../types/convert';
import { Button } from '../common/Button';
import { SegmentedControl } from '../common/SegmentedControl';
import { Select, type SelectOption } from '../common/Select';
import { Slider } from '../common/Slider';
import { CapabilityInfo } from './CapabilityInfo';

const VIDEO_TARGET_HINT: Record<ConvertVideoTarget, string> = {
  mp4: 'H.264 video with AAC audio. Plays almost everywhere.',
  webm: 'VP9 where your browser can encode it, otherwise VP8. Good for the web.',
  gif: 'Looping animation without sound, at 12 frames per second. Long clips make large files.',
  mp3: 'Extracts the sound track at 192 kbps. The video is dropped.',
  m4a: 'Extracts the sound track as AAC at 192 kbps. The video is dropped.',
  wav: 'Extracts the sound track as uncompressed audio. Large, but lossless from here on.',
};

const GIF_WIDTHS: SelectOption<GifWidth>[] = [
  { value: 320, label: '320 px wide' },
  { value: 480, label: '480 px wide' },
  { value: 720, label: '720 px wide' },
  { value: 'original', label: 'Original width' },
];

export function ConvertSettingsPanel({ defaultTab }: { defaultTab: 'image' | 'video' }) {
  const [tab, setTab] = useState<'image' | 'video'>(defaultTab);
  const settings = useConvertSettingsStore();
  const caps = useCapabilitiesStore((s) => s.image);
  const ready = useCapabilitiesStore((s) => s.ready);

  const imageTargets: SelectOption<ConvertImageTarget>[] = [
    { value: 'webp', label: ready && !caps.webp ? 'WebP (not supported here)' : 'WebP', disabled: ready && !caps.webp },
    { value: 'jpeg', label: 'JPG' },
    { value: 'png', label: 'PNG' },
    { value: 'avif', label: caps.avifNative ? 'AVIF' : 'AVIF (WebAssembly, slower)' },
  ];
  const videoTargets = (Object.keys(VIDEO_TARGET_LABEL) as ConvertVideoTarget[]).map((value) => ({
    value,
    label: VIDEO_TARGET_LABEL[value],
  }));

  return (
    <section aria-labelledby="convert-settings-title" className="card p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 id="convert-settings-title" className="text-sm font-semibold text-fg">
          Conversion settings
        </h2>
        <Button variant="ghost" size="sm" onClick={settings.reset} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
          Reset
        </Button>
      </div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Convert</span>
        <SegmentedControl
          label="Settings type"
          size="sm"
          value={tab}
          onChange={setTab}
          segments={[
            { value: 'image', label: <><ImageIcon className="h-3.5 w-3.5" aria-hidden /> Images</> },
            { value: 'video', label: <><Film className="h-3.5 w-3.5" aria-hidden /> Videos</> },
          ]}
        />
      </div>
      {tab === 'image' ? (
        <div className="space-y-5">
          <Select
            label="Convert images to"
            value={settings.image}
            options={imageTargets}
            onChange={(image) => settings.update({ image })}
            hint="iPhone HEIC photos work too: pick JPG for the widest support. Transparent areas become white in JPG."
          />
          {settings.image === 'png' ? (
            <p className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-xs text-muted">
              PNG is lossless, so every pixel is kept exactly. There is no quality setting.
            </p>
          ) : (
            <Slider
              label="Quality"
              min={50}
              max={100}
              value={settings.imageQuality}
              onChange={(imageQuality) => settings.update({ imageQuality })}
              hint="90 keeps the picture visually identical to the source."
            />
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <Select
            label="Convert videos to"
            value={settings.video}
            options={videoTargets}
            onChange={(video) => settings.update({ video })}
            hint={VIDEO_TARGET_HINT[settings.video]}
          />
          {settings.video === 'gif' && (
            <Select label="GIF size" value={settings.gifWidth} options={GIF_WIDTHS} onChange={(gifWidth) => settings.update({ gifWidth })} />
          )}
          <p className="text-xs text-muted">
            GIF files are read as animations, so they appear here. Convert them to MP4 or WebM for much smaller files.
          </p>
        </div>
      )}
      <div className="mt-6">
        <CapabilityInfo />
      </div>
    </section>
  );
}
