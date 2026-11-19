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
  debugMatte: false,
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
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        background: s.background,
        color: s.color,
        format: s.format,
        trim: s.trim,
        debugMatte: s.debugMatte,
      }),
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<BackgroundSettings>;
        return {
          background: p.background ?? DEFAULT_BACKGROUND_SETTINGS.background,
          color: p.color ?? DEFAULT_BACKGROUND_SETTINGS.color,
          format: p.format ?? DEFAULT_BACKGROUND_SETTINGS.format,
          trim: p.trim === true,
          debugMatte: p.debugMatte === true,
        };
      },
    },
  ),
);
