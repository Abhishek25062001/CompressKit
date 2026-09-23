import { useShallow } from 'zustand/react/shallow';
import { useQueueStore } from '../store/queueStore';

export interface QueueSummary {
  total: number;
  waiting: number;
  compressing: number;
  completed: number;
  failed: number;
  images: number;
  videos: number;
  originalBytes: number;
  completedOriginalBytes: number;
  completedBytes: number;
}

/** Aggregates queue counters with a shallow comparison so progress ticks do not re-render summary UI. */
export function useQueueSummary(): QueueSummary {
  return useQueueStore(
    useShallow((s) => {
      const summary: QueueSummary = {
        total: s.order.length,
        waiting: 0,
        compressing: 0,
        completed: 0,
        failed: 0,
        images: 0,
        videos: 0,
        originalBytes: 0,
        completedOriginalBytes: 0,
        completedBytes: 0,
      };
      for (const id of s.order) {
        const item = s.items[id];
        if (!item) continue;
        summary.originalBytes += item.size;
        if (item.kind === 'image') summary.images++;
        else summary.videos++;
        if (item.status === 'waiting') summary.waiting++;
        else if (item.status === 'compressing') summary.compressing++;
        else if (item.status === 'completed' && item.result) {
          summary.completed++;
          summary.completedOriginalBytes += item.size;
          summary.completedBytes += item.result.size;
        } else if (item.status === 'failed' || item.status === 'cancelled') summary.failed++;
      }
      return summary;
    }),
  );
}
