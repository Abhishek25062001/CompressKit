import type { WorkerResponse } from '../../types/worker';

export type WorkerFactory = () => Worker;

/** Any worker reply the slot can route: it only needs to know the job and whether it is final. */
interface SlotMessage {
  type: string;
  jobId: string;
}

export interface SlotCallbacks<M extends SlotMessage = WorkerResponse> {
  onMessage: (message: M) => void;
  onCrash: (detail: string) => void;
}

/**
 * Owns a single worker. Workers are created lazily, reused between jobs, and terminated on
 * cancellation, crash or idleness so their memory (WebAssembly heaps, decoders) is released.
 */
export class WorkerSlot {
  private worker: Worker | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  jobId: string | null = null;

  constructor(
    private readonly factory: WorkerFactory,
    private readonly idleMs: number,
  ) {}

  get busy(): boolean {
    return this.jobId !== null;
  }

  run<M extends SlotMessage = WorkerResponse>(jobId: string, message: unknown, callbacks: SlotCallbacks<M>): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.jobId = jobId;
    const worker = (this.worker ??= this.factory());
    worker.onmessage = (event: MessageEvent<M>) => {
      if (event.data.jobId !== this.jobId) return;
      if (event.data.type !== 'progress') this.release();
      callbacks.onMessage(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      const detail = event.message || 'worker error';
      this.terminate();
      callbacks.onCrash(detail);
    };
    worker.onmessageerror = () => {
      this.terminate();
      callbacks.onCrash('message could not be deserialized');
    };
    worker.postMessage(message);
  }

  /** Stops the current job immediately by killing the worker. */
  terminate(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.worker?.terminate();
    this.worker = null;
    this.jobId = null;
  }

  private release(): void {
    this.jobId = null;
    this.idleTimer = setTimeout(() => this.terminate(), this.idleMs);
  }
}
