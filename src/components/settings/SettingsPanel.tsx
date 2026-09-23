import { Film, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { Button } from '../common/Button';
import { SegmentedControl } from '../common/SegmentedControl';
import { CapabilityInfo } from './CapabilityInfo';
import { ImageSettingsForm } from './ImageSettingsForm';
import { PresetPicker } from './PresetPicker';
import { VideoSettingsForm } from './VideoSettingsForm';

export function SettingsPanel({ defaultTab }: { defaultTab: 'image' | 'video' }) {
  const [tab, setTab] = useState<'image' | 'video'>(defaultTab);
  const preset = useSettingsStore((s) => s.preset);
  const image = useSettingsStore((s) => s.image);
  const video = useSettingsStore((s) => s.video);
  const applyPreset = useSettingsStore((s) => s.applyPreset);
  const updateImage = useSettingsStore((s) => s.updateImage);
  const updateVideo = useSettingsStore((s) => s.updateVideo);
  const reset = useSettingsStore((s) => s.reset);

  return (
    <section aria-labelledby="settings-title" className="card p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 id="settings-title" className="text-sm font-semibold text-fg">
          Compression settings
        </h2>
        <Button variant="ghost" size="sm" onClick={reset} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
          Reset
        </Button>
      </div>
      <PresetPicker name="global-preset" value={preset} onChange={applyPreset} />
      <div className="my-5 h-px bg-border" />
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Advanced</span>
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
        <ImageSettingsForm value={image} onChange={updateImage} />
      ) : (
        <VideoSettingsForm value={video} onChange={updateVideo} />
      )}
      <div className="mt-6">
        <CapabilityInfo />
      </div>
    </section>
  );
}
