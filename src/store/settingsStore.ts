import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS, getPreset, matchPreset } from '../constants/presets';
import { CONTAINER_CODECS } from '../features/video/videoParams';
import type {
  CompressionSettings,
  ImageSettings,
  PresetId,
  VideoSettings,
} from '../types/settings';

interface SettingsState extends CompressionSettings {
  applyPreset: (id: PresetId) => void;
  updateImage: (patch: Partial<ImageSettings>) => void;
  updateVideo: (patch: Partial<VideoSettings>) => void;
  reset: () => void;
}

/** Keeps codec valid for the chosen container. */
export function normalizeVideo(video: VideoSettings): VideoSettings {
  const allowed = CONTAINER_CODECS[video.container];
  if (allowed.includes(video.codec)) return video;
  return { ...video, codec: video.container === 'mp4' ? 'h264' : 'vp9' };
}

export function applyPresetTo(
  id: PresetId,
  image: ImageSettings,
  video: VideoSettings,
): { image: ImageSettings; video: VideoSettings } {
  const p = getPreset(id);
  return {
    image: { ...image, quality: p.imageQuality },
    video: { ...video, quality: p.videoQuality, audioBitrate: p.audioBitrate },
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      applyPreset: (id) =>
        set((s) => ({ preset: id, ...applyPresetTo(id, s.image, s.video) })),
      updateImage: (patch) =>
        set((s) => {
          const image = { ...s.image, ...patch };
          return { image, preset: matchPreset(image, s.video) };
        }),
      updateVideo: (patch) =>
        set((s) => {
          const video = normalizeVideo({ ...s.video, ...patch });
          return { video, preset: matchPreset(s.image, video) };
        }),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'compresskit-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ preset: s.preset, image: s.image, video: s.video }),
    },
  ),
);
