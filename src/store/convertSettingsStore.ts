import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ConvertSettings } from '../types/convert';

interface ConvertSettingsState extends ConvertSettings {
  update: (patch: Partial<ConvertSettings>) => void;
  reset: () => void;
}

export const DEFAULT_CONVERT_SETTINGS: ConvertSettings = {
  image: 'webp',
  imageQuality: 90,
  video: 'mp4',
  gifWidth: 480,
};

export const useConvertSettingsStore = create<ConvertSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_CONVERT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_CONVERT_SETTINGS }),
    }),
    {
      name: 'compresskit-convert-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ image: s.image, imageQuality: s.imageQuality, video: s.video, gifWidth: s.gifWidth }),
    },
  ),
);
