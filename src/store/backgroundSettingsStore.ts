import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BackgroundSettings } from '../types/background';

interface BackgroundSettingsState extends BackgroundSettings {
  update: (patch: Partial<BackgroundSettings>) => void;
  reset: () => void;
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  background: 'transparent',
  color: '#ffffff',
  format: 'png',
  trim: false,
};

export const useBackgroundSettingsStore = create<BackgroundSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_BACKGROUND_SETTINGS,
      update: (patch) =>
        set((s) => {
          const next = { ...s, ...patch };
          // A transparent cut-out cannot be a JPEG.
          if (next.background === 'transparent' && next.format === 'jpeg') next.format = 'png';
          return next;
        }),
      reset: () => set({ ...DEFAULT_BACKGROUND_SETTINGS }),
    }),
    {
      name: 'compresskit-background-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ background: s.background, color: s.color, format: s.format, trim: s.trim }),
    },
  ),
);
