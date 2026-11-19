import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { WatermarkSettings } from '../types/watermark';

interface WatermarkSettingsState extends WatermarkSettings {
  update: (patch: Partial<WatermarkSettings>) => void;
  reset: () => void;
}

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  format: 'original',
  expand: 10,
  debugMask: false,
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
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ format: s.format, expand: s.expand, debugMask: s.debugMask }),
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as Partial<WatermarkSettings>;
        return {
          format: p.format ?? DEFAULT_WATERMARK_SETTINGS.format,
          // v1 used a 2 px default; move everyone to 10 so soft sparkle glows are covered.
          expand: fromVersion < 2 ? 10 : typeof p.expand === 'number' ? p.expand : 10,
          debugMask: p.debugMask === true,
        };
      },
    },
  ),
);
