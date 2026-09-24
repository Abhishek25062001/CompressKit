import { toFriendlyError } from '../../constants/errors';
import type { QueueStore } from '../../store/queueStore';
import type { CompressionResult, ErrorCode, QueueItem } from '../../types/media';
import { classifyError, describeError } from '../../utils/errors';
import type { QueueManager } from '../tools';

export type ProgressFn = (progress: number | null, stage: string) => void;

export interface ProcessOutput {
  result: Omit<CompressionResult, 'url' | 'elapsedMs'>;
  /** Extra fields to store on the queue item along with the result. */
  patch?: Partial<QueueItem>;
}

/**
 * Runs a tool's queue with up to `parallel` jobs at once. Subclasses only say how one file is
 * processed; starting, cancelling, retrying and settling the queue work the same for every tool.
 */
export abstract class QueueRunner implements QueueManager {
  protected readonly active = new Set<string>();
  private readonly startedAt = new Map<string, number>();

  constructor(
    protected readonly queue: QueueStore,
    private readonly parallel: number,
  ) {}

  protected abstract process(item: QueueItem, onProgress: ProgressFn): Promise<ProcessOutput>;

  /** Stops the work for a job that is being cancelled or removed, e.g. by terminating its worker. */
  protected abort(id: string): void {
    void id;
  }

  /** Drops anything cached for an item that leaves the queue. Null means every item. */
  protected forget(id: string | null): void {
    void id;
  }

  start(): void {
    const queue = this.queue.getState();
    if (!queue.order.some((id) => queue.items[id]?.status === 'waiting')) return;
    queue.setRunning(true);
    this.pump();
  }

  cancel(id: string): void {
    const item = this.queue.getState().items[id];
    if (!item) return;
    if (item.status === 'compressing') this.abort(id);
    if (item.status === 'compressing' || item.status === 'waiting') {
      this.active.delete(id);
      this.fail(id, 'CANCELLED', 'cancelled by user');
    }
    this.pump();
  }

  cancelAll(): void {
    this.queue.getState().order.forEach((id) => this.cancel(id));
  }

  remove(id: string): void {
    if (this.active.has(id)) this.abort(id);
    this.active.delete(id);
    this.forget(id);
    this.queue.getState().removeItem(id);
    this.pump();
  }

  clear(): void {
    this.active.forEach((id) => this.abort(id));
    this.active.clear();
    this.forget(null);
    this.queue.getState().clear();
  }

  retry(id: string): void {
    this.forget(id);
    this.queue.getState().updateItem(id, { status: 'waiting', error: null, progress: null, stage: null });
    this.start();
  }

  protected pump(): void {
    const queue = this.queue.getState();
    if (!queue.running) return;
    for (const id of queue.order) {
      if (this.active.size >= this.parallel) break;
      const item = queue.items[id];
      if (item?.status === 'waiting') void this.run(item);
    }
    const after = this.queue.getState();
    const unsettled = after.order.some((id) => {
      const s = after.items[id]?.status;
      return s === 'waiting' || s === 'compressing';
    });
    if (!unsettled) after.setRunning(false);
  }

  private async run(item: QueueItem): Promise<void> {
    const { id } = item;
    this.active.add(id);
    this.startedAt.set(id, performance.now());
    this.queue.getState().updateItem(id, { status: 'compressing', progress: null, stage: 'Starting', error: null });
    const onProgress: ProgressFn = (progress, stage) => {
      if (this.active.has(id)) this.queue.getState().updateItem(id, { progress, stage });
    };
    try {
      const { result, patch } = await this.process(item, onProgress);
      if (!this.active.has(id)) return;
      const elapsedMs = performance.now() - (this.startedAt.get(id) ?? performance.now());
      this.queue.getState().updateItem(id, {
        ...patch,
        status: 'completed',
        progress: 1,
        stage: null,
        result: { ...result, url: URL.createObjectURL(result.blob), elapsedMs },
      });
    } catch (error) {
      if (this.active.has(id)) this.fail(id, classifyError(error), describeError(error));
    } finally {
      this.active.delete(id);
      this.startedAt.delete(id);
      this.pump();
    }
  }

  private fail(id: string, code: ErrorCode, detail: string): void {
    this.startedAt.delete(id);
    if (code !== 'CANCELLED') console.warn(`[CompressKit] ${code}:`, detail);
    this.queue.getState().updateItem(id, {
      status: code === 'CANCELLED' ? 'cancelled' : 'failed',
      progress: null,
      stage: null,
      error: toFriendlyError(code),
    });
  }
}
