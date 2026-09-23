import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ResizeSettings } from '../types/resize';

interface ResizeSettingsState extends ResizeSettings {
  update: (patch: Partial<ResizeSettings>) => void;
  reset: () => void;
}

export const DEFAULT_RESIZE_SETTINGS: ResizeSettings = {
  preset: 'passport',
  customWidth: 1200,
  customHeight: 800,
  format: 'jpeg',
  targetKB: null,
};

export const useResizeSettingsStore = create<ResizeSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_RESIZE_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set({ ...DEFAULT_RESIZE_SETTINGS }),
    }),
    {
      name: 'compresskit-resize-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        preset: s.preset,
        customWidth: s.customWidth,
        customHeight: s.customHeight,
        format: s.format,
        targetKB: s.targetKB,
      }),
    },
  ),
);
