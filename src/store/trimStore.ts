import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { FriendlyError } from '../types/media';
import type { TimeRange, TrimDoneMessage, TrimSettings } from '../types/trim';

export interface TrimSource {
  file: File;
  /** Object URL for the preview player. */
  url: string;
  name: string;
  duration: number;
  width?: number;
  height?: number;
  /** False when this browser cannot play the file; it can usually still be cut. */
  playable: boolean;
}

export interface TrimPart {
  blob: Blob;
  url: string;
  fileName: string;
  start: number;
  end: number;
}

export type TrimStatus = 'idle' | 'running' | 'done' | 'failed';

export const DEFAULT_TRIM_SETTINGS: TrimSettings = {
  mode: 'trim',
  method: 'fast',
  partSeconds: 60,
  resolution: 'original',
  keepAudio: true,
};

interface TrimState {
  source: TrimSource | null;
  /** Set while a dropped file is being read. */
  loading: boolean;
  range: TimeRange;
  settings: TrimSettings;
  status: TrimStatus;
  progress: number | null;
  stage: string | null;
  parts: TrimPart[];
  notes: string[];
  engine: TrimDoneMessage['engine'] | null;
  elapsedMs: number;
  error: FriendlyError | null;

  setLoading: (loading: boolean) => void;
  setSource: (source: TrimSource) => void;
  setRange: (range: TimeRange) => void;
  updateSettings: (patch: Partial<TrimSettings>) => void;
  resetSettings: () => void;
  startJob: () => void;
  setProgress: (progress: number | null, stage: string) => void;
  finishJob: (result: { parts: TrimPart[]; notes: string[]; engine: TrimDoneMessage['engine']; elapsedMs: number }) => void;
  failJob: (error: FriendlyError | null) => void;
  clear: () => void;
}

function revokeParts(parts: TrimPart[]): void {
  parts.forEach((p) => URL.revokeObjectURL(p.url));
}

const idleJob = {
  status: 'idle' as TrimStatus,
  progress: null,
  stage: null,
  parts: [],
  notes: [],
  engine: null,
  elapsedMs: 0,
  error: null,
};

export const useTrimStore = create<TrimState>()(
  persist(
    (set, get) => ({
      source: null,
      loading: false,
      range: { start: 0, end: 0 },
      settings: DEFAULT_TRIM_SETTINGS,
      ...idleJob,

      setLoading: (loading) => set({ loading }),
      setSource: (source) => {
        const prev = get();
        if (prev.source) URL.revokeObjectURL(prev.source.url);
        revokeParts(prev.parts);
        set({ source, loading: false, range: { start: 0, end: source.duration }, ...idleJob });
      },
      setRange: (range) => set({ range }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_TRIM_SETTINGS }),
      startJob: () => {
        revokeParts(get().parts);
        set({ ...idleJob, status: 'running', stage: 'Preparing' });
      },
      setProgress: (progress, stage) => set({ progress, stage }),
      finishJob: ({ parts, notes, engine, elapsedMs }) =>
        set({ status: 'done', progress: 1, stage: null, parts, notes, engine, elapsedMs }),
      failJob: (error) => set({ ...idleJob, status: error ? 'failed' : 'idle', error }),
      clear: () => {
        const prev = get();
        if (prev.source) URL.revokeObjectURL(prev.source.url);
        revokeParts(prev.parts);
        set({ source: null, loading: false, range: { start: 0, end: 0 }, ...idleJob });
      },
    }),
    {
      name: 'compresskit-trim-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only the settings are remembered; files never leave memory.
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => ({
        ...current,
        settings: { ...DEFAULT_TRIM_SETTINGS, ...(persisted as { settings?: Partial<TrimSettings> } | undefined)?.settings },
      }),
    },
  ),
);
