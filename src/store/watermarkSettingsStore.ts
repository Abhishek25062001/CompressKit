import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { WatermarkSettings } from '../types/watermark';

interface WatermarkSettingsState extends WatermarkSettings {
  update: (patch: Partial<WatermarkSettings>) => void;
  reset: () => void;
}

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  format: 'original',
  expand: 2,
};

export const useWatermarkSettingsStore = create<WatermarkSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_WATERMARK_SETTINGS,
      update: (patch) => set((s) => ({ ...s, ...patch })),
      reset: () => set({ ...DEFAULT_WATERMARK_SETTINGS }),
    }),
    {
      name: 'compresskit-watermark-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ format: s.format, expand: s.expand }),
    },
  ),
);
