import { create } from 'zustand';
import type { QueueItem } from '../types/media';

export interface QueueState {
  order: string[];
  items: Record<string, QueueItem>;
  /** True from pressing "Compress" until every queued file has settled. */
  running: boolean;
  /** Set once a run has finished, until the queue is cleared. Drives the completion screen. */
  hasFinishedRun: boolean;
  addItems: (items: QueueItem[]) => void;
  updateItem: (id: string, patch: Partial<QueueItem>) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  setRunning: (running: boolean) => void;
}

function releaseItem(item: QueueItem): void {
  if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  if (item.result) URL.revokeObjectURL(item.result.url);
}

/** Each tool (compressor, converter) owns an independent queue built from this factory. */
export const createQueueStore = () => create<QueueState>()((set, get) => ({
  order: [],
  items: {},
  running: false,
  hasFinishedRun: false,
  addItems: (newItems) =>
    set((s) => {
      const items = { ...s.items };
      for (const item of newItems) items[item.id] = item;
      return { items, order: [...s.order, ...newItems.map((i) => i.id)] };
    }),
  updateItem: (id, patch) =>
    set((s) => {
      const current = s.items[id];
      if (!current) return s;
      // Release a replaced result so repeated compressions do not leak object URLs.
      if (patch.result !== undefined && current.result && patch.result !== current.result) {
        URL.revokeObjectURL(current.result.url);
      }
      return { items: { ...s.items, [id]: { ...current, ...patch } } };
    }),
  removeItem: (id) => {
    const item = get().items[id];
    if (item) releaseItem(item);
    set((s) => {
      const items = { ...s.items };
      delete items[id];
      const order = s.order.filter((x) => x !== id);
      return { items, order, hasFinishedRun: order.length > 0 && s.hasFinishedRun };
    });
  },
  clear: () => {
    Object.values(get().items).forEach(releaseItem);
    set({ items: {}, order: [], running: false, hasFinishedRun: false });
  },
  setRunning: (running) =>
    set((s) => ({ running, hasFinishedRun: running ? false : s.hasFinishedRun || s.running })),
}));

export type QueueStore = ReturnType<typeof createQueueStore>;

export const useQueueStore = createQueueStore();
export const useConvertQueueStore = createQueueStore();

/** Selectors kept outside components so they are stable references. */
export const selectOrder = (s: QueueState) => s.order;
export const selectRunning = (s: QueueState) => s.running;
