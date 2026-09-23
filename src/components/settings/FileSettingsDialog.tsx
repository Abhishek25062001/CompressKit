import { useState } from 'react';
import { useQueueStore } from '../../store/queueStore';
import { applyPresetTo, normalizeVideo, useSettingsStore } from '../../store/settingsStore';
import { useUiStore } from '../../store/uiStore';
import { matchPreset } from '../../constants/presets';
import type { ImageSettings, PresetId, VideoSettings } from '../../types/settings';
import type { QueueItem } from '../../types/media';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { ImageSettingsForm } from './ImageSettingsForm';
import { PresetPicker } from './PresetPicker';
import { VideoSettingsForm } from './VideoSettingsForm';

function DialogBody({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const global = useSettingsStore.getState();
  const updateItem = useQueueStore((s) => s.updateItem);
  const [image, setImage] = useState<ImageSettings>(item.override?.image ?? global.image);
  const [video, setVideo] = useState<VideoSettings>(item.override?.video ?? global.video);
  const preset = matchPreset(image, video);

  const onPreset = (id: PresetId) => {
    const next = applyPresetTo(id, image, video);
    setImage(next.image);
    setVideo(next.video);
  };

  const save = () => {
    updateItem(item.id, {
      override: item.kind === 'image' ? { image } : { video },
      // A finished file can be compressed again with its new settings.
      ...(item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled'
        ? { status: 'waiting' as const, error: null }
        : {}),
    });
    onClose();
  };

  const useGlobal = () => {
    updateItem(item.id, { override: null });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="File settings"
      description={item.name}
      footer={
        <>
          {item.override && (
            <Button variant="ghost" onClick={useGlobal} className="mr-auto">
              Use global settings
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save for this file
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <PresetPicker name="file-preset" value={preset} onChange={onPreset} />
        <div className="h-px bg-border" />
        {item.kind === 'image' ? (
          <ImageSettingsForm value={image} onChange={(p) => setImage((s) => ({ ...s, ...p }))} />
        ) : (
          <VideoSettingsForm value={video} onChange={(p) => setVideo((s) => normalizeVideo({ ...s, ...p }))} />
        )}
      </div>
    </Modal>
  );
}

export function FileSettingsDialog() {
  const editingId = useUiStore((s) => s.editingFileId);
  const close = useUiStore((s) => s.closeFileSettings);
  const item = useQueueStore((s) => (editingId ? s.items[editingId] : undefined));
  if (!item) return null;
  // Keyed by id so the draft state resets for each file.
  return <DialogBody key={item.id} item={item} onClose={close} />;
}
