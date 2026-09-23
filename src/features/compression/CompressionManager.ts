import ffmpegCoreUrl from '@ffmpeg/core?url';
import ffmpegWasmUrl from '@ffmpeg/core/wasm?url';
import { toFriendlyError } from '../../constants/errors';
import { MIME_EXTENSION, MIME_LABEL, getExtension } from '../../constants/formats';
import { useCapabilitiesStore } from '../../store/capabilitiesStore';
import { useQueueStore } from '../../store/queueStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { CompressionResult, ErrorCode, QueueItem } from '../../types/media';
import type { ImageJobRequest, VideoJobRequest, WorkerDoneMessage, WorkerResponse } from '../../types/worker';
import { classifyError, describeError } from '../../utils/errors';
import { buildOutputName } from '../../utils/filename';
import { probeVideo } from '../../utils/probe';
import { WorkerSlot } from './workerSlot';

const ENGINE_LABEL: Record<string, string> = {
  canvas: 'Canvas',
  upng: 'PNG quantizer',
  'wasm-avif': 'AVIF (WebAssembly)',
  webcodecs: 'WebCodecs',
  ffmpeg: 'FFmpeg.wasm',
  original: 'Original kept',
};

export function engineLabel(engine: string): string {
  return ENGINE_LABEL[engine] ?? engine;
}

const createImageWorker = () =>
  new Worker(new URL('../../workers/image.worker.ts', import.meta.url), { type: 'module', name: 'compresskit-image' });
const createVideoWorker = () =>
  new Worker(new URL('../../workers/video.worker.ts', import.meta.url), { type: 'module', name: 'compresskit-video' });

function imagePoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/**
 * Schedules queued files onto workers. Images run in a small pool; videos run one at a time,
 * because a single transcode already saturates the CPU or hardware encoder and memory.
 */
class CompressionManager {
  private imageSlots: WorkerSlot[] = [];
  private videoSlot = new WorkerSlot(createVideoWorker, 60_000);
  /** Items running on the main thread (image fallback without OffscreenCanvas). */
  private mainThreadJobs = new Set<string>();
  private cancelledMainThread = new Set<string>();
  private startedAt = new Map<string, number>();

  constructor() {
    for (let i = 0; i < imagePoolSize(); i++) this.imageSlots.push(new WorkerSlot(createImageWorker, 20_000));
  }

  start(): void {
    const queue = useQueueStore.getState();
    if (!queue.order.some((id) => queue.items[id]?.status === 'waiting')) return;
    queue.setRunning(true);
    this.pump();
  }

  cancel(id: string): void {
    const item = useQueueStore.getState().items[id];
    if (!item) return;
    if (item.status === 'compressing') {
      const slot = [...this.imageSlots, this.videoSlot].find((s) => s.jobId === id);
      slot?.terminate();
      if (this.mainThreadJobs.has(id)) this.cancelledMainThread.add(id);
      this.mainThreadJobs.delete(id);
    }
    if (item.status === 'compressing' || item.status === 'waiting') {
      this.fail(id, 'CANCELLED', 'cancelled by user', 'cancelled');
    }
    this.pump();
  }

  cancelAll(): void {
    const { order } = useQueueStore.getState();
    order.forEach((id) => this.cancel(id));
  }

  /** Cancels any running job for this item and removes it from the queue. */
  remove(id: string): void {
    const item = useQueueStore.getState().items[id];
    if (item?.status === 'compressing') this.cancel(id);
    useQueueStore.getState().removeItem(id);
    this.pump();
  }

  clear(): void {
    this.cancelAll();
    useQueueStore.getState().clear();
  }

  retry(id: string): void {
    useQueueStore.getState().updateItem(id, { status: 'waiting', error: null, progress: null, stage: null });
    this.start();
  }

  private pump(): void {
    const queue = useQueueStore.getState();
    if (!queue.running) return;
    const waiting = queue.order.map((id) => queue.items[id]).filter((i): i is QueueItem => i?.status === 'waiting');

    for (const item of waiting) {
      if (item.kind === 'image') {
        const useWorker = useCapabilitiesStore.getState().browser.offscreenCanvas;
        if (useWorker) {
          const slot = this.imageSlots.find((s) => !s.busy);
          if (slot) this.runImageInWorker(item, slot);
        } else if (this.mainThreadJobs.size === 0) {
          void this.runImageOnMainThread(item);
        }
      } else if (!this.videoSlot.busy) {
        this.runVideo(item);
      }
    }

    const after = useQueueStore.getState();
    const unsettled = after.order.some((id) => {
      const s = after.items[id]?.status;
      return s === 'waiting' || s === 'compressing';
    });
    if (!unsettled) after.setRunning(false);
  }

  private markStarted(item: QueueItem, stage: string): void {
    this.startedAt.set(item.id, performance.now());
    useQueueStore.getState().updateItem(item.id, {
      status: 'compressing',
      progress: null,
      stage,
      error: null,
    });
  }

  private imageSettingsFor(item: QueueItem) {
    return item.override?.image ?? useSettingsStore.getState().image;
  }

  private videoSettingsFor(item: QueueItem) {
    return item.override?.video ?? useSettingsStore.getState().video;
  }

  private imageSupport() {
    const caps = useCapabilitiesStore.getState().image;
    return { webp: caps.webp, avif: caps.avifNative };
  }

  private runImageInWorker(item: QueueItem, slot: WorkerSlot): void {
    this.markStarted(item, 'Starting');
    const request: ImageJobRequest = {
      type: 'compress',
      jobId: item.id,
      file: item.file,
      settings: this.imageSettingsFor(item),
      support: this.imageSupport(),
    };
    slot.run(item.id, request, {
      onMessage: (msg) => this.handleMessage(item.id, msg),
      onCrash: (detail) => {
        this.fail(item.id, 'WORKER_CRASHED', detail);
        this.pump();
      },
    });
  }

  private async runImageOnMainThread(item: QueueItem): Promise<void> {
    this.mainThreadJobs.add(item.id);
    this.markStarted(item, 'Starting');
    try {
      const { encodeImage } = await import('../image/encodeImage');
      const out = await encodeImage({
        file: item.file,
        settings: this.imageSettingsFor(item),
        support: this.imageSupport(),
        onStage: (stage) => {
          if (!this.cancelledMainThread.has(item.id)) useQueueStore.getState().updateItem(item.id, { stage });
        },
      });
      if (this.cancelledMainThread.delete(item.id)) return;
      await this.complete(item.id, { type: 'done', jobId: item.id, ...out });
    } catch (error) {
      if (!this.cancelledMainThread.delete(item.id)) this.fail(item.id, classifyError(error), describeError(error));
    } finally {
      this.mainThreadJobs.delete(item.id);
      this.pump();
    }
  }

  private runVideo(item: QueueItem): void {
    this.markStarted(item, 'Preparing');
    const request: VideoJobRequest = {
      type: 'compress',
      jobId: item.id,
      file: item.file,
      settings: this.videoSettingsFor(item),
      source: { width: item.meta.width, height: item.meta.height, duration: item.meta.duration },
      ffmpeg: {
        coreURL: new URL(ffmpegCoreUrl, window.location.href).href,
        wasmURL: new URL(ffmpegWasmUrl, window.location.href).href,
      },
    };
    this.videoSlot.run(item.id, request, {
      onMessage: (msg) => this.handleMessage(item.id, msg),
      onCrash: (detail) => {
        this.fail(item.id, 'WORKER_CRASHED', detail);
        this.pump();
      },
    });
  }

  private handleMessage(id: string, msg: WorkerResponse): void {
    const item = useQueueStore.getState().items[id];
    if (!item || item.status !== 'compressing') return;
    switch (msg.type) {
      case 'progress':
        useQueueStore.getState().updateItem(id, { progress: msg.progress, stage: msg.stage });
        break;
      case 'done':
        void this.complete(id, msg).finally(() => this.pump());
        break;
      case 'error':
        this.fail(id, msg.code, msg.detail);
        this.pump();
        break;
    }
  }

  private async complete(id: string, msg: WorkerDoneMessage): Promise<void> {
    const item = useQueueStore.getState().items[id];
    if (!item) return;
    const elapsedMs = performance.now() - (this.startedAt.get(id) ?? performance.now());
    this.startedAt.delete(id);

    let { width, height } = msg;
    let duration: number | undefined;
    if (item.kind === 'video') {
      if (msg.keptOriginal) {
        ({ width, height, duration } = item.meta);
      } else {
        const probe = await probeVideo(msg.blob, false);
        width ??= probe.meta.width;
        height ??= probe.meta.height;
        duration = probe.meta.duration;
      }
    }

    const extension = MIME_EXTENSION[msg.mime] ?? (getExtension(item.name) || 'bin');
    const result: CompressionResult = {
      blob: msg.blob,
      url: URL.createObjectURL(msg.blob),
      fileName: buildOutputName(item.name, extension, msg.keptOriginal),
      mime: msg.mime,
      formatLabel: MIME_LABEL[msg.mime] ?? extension.toUpperCase(),
      size: msg.blob.size,
      width,
      height,
      duration,
      elapsedMs,
      engine: msg.engine as CompressionResult['engine'],
      notes: msg.notes,
      keptOriginal: msg.keptOriginal,
    };
    // The item may have been removed or cancelled while probing.
    const current = useQueueStore.getState().items[id];
    if (!current || current.status !== 'compressing') {
      URL.revokeObjectURL(result.url);
      return;
    }
    useQueueStore.getState().updateItem(id, { status: 'completed', progress: 1, stage: null, result });
  }

  private fail(id: string, code: ErrorCode, detail: string, status: 'failed' | 'cancelled' = 'failed'): void {
    this.startedAt.delete(id);
    if (code !== 'CANCELLED') console.warn(`[CompressKit] ${code}:`, detail);
    useQueueStore.getState().updateItem(id, {
      status: code === 'CANCELLED' ? 'cancelled' : status,
      progress: null,
      stage: null,
      error: toFriendlyError(code),
    });
  }
}

export const compressionManager = new CompressionManager();
