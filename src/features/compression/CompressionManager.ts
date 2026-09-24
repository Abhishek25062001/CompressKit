import ffmpegCoreUrl from '@ffmpeg/core?url';
import ffmpegWasmUrl from '@ffmpeg/core/wasm?url';
import { toFriendlyError } from '../../constants/errors';
import { MIME_EXTENSION, MIME_LABEL, getExtension } from '../../constants/formats';
import { useCapabilitiesStore } from '../../store/capabilitiesStore';
import { useConvertSettingsStore } from '../../store/convertSettingsStore';
import { useConvertQueueStore, useQueueStore, useResizeQueueStore, type QueueStore } from '../../store/queueStore';
import { useResizeSettingsStore } from '../../store/resizeSettingsStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { CompressionResult, ErrorCode, QueueItem, ToolMode } from '../../types/media';
import type { ImageTransform } from '../../types/resize';
import type { ImageSettings, VideoSettings } from '../../types/settings';
import type { ImageJobRequest, VideoJobRequest, VideoOutput, WorkerDoneMessage, WorkerResponse } from '../../types/worker';
import { classifyError, describeError } from '../../utils/errors';
import { buildOutputName, sanitizeBaseName } from '../../utils/filename';
import { probeImage, probeVideo } from '../../utils/probe';
import { convertImageSettings, convertVideoOutput, convertVideoSettings } from '../convert/convertJob';
import { resizeImageSettings, resizeTransform } from '../resize/resizeJob';
import { WorkerSlot } from './workerSlot';

const ENGINE_LABEL: Record<string, string> = {
  canvas: 'Canvas',
  upng: 'PNG quantizer',
  'wasm-avif': 'AVIF (WebAssembly)',
  webcodecs: 'WebCodecs',
  ffmpeg: 'FFmpeg.wasm',
  original: 'Original kept',
  metadata: 'Metadata removed',
  webgpu: 'AI on GPU (WebGPU)',
  wasm: 'AI on CPU (WebAssembly)',
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

/** Where a manager reads the settings for each file. */
interface JobResolver {
  image(item: QueueItem): ImageSettings;
  video(item: QueueItem): VideoSettings;
  videoOutput(item: QueueItem): VideoOutput;
  /** Crop and exact output size, for the resize tool. */
  transform?(item: QueueItem): ImageTransform;
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

  constructor(
    readonly mode: ToolMode,
    private readonly queue: QueueStore,
    private readonly resolve: JobResolver,
  ) {
    for (let i = 0; i < imagePoolSize(); i++) this.imageSlots.push(new WorkerSlot(createImageWorker, 20_000));
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
    const { order } = this.queue.getState();
    order.forEach((id) => this.cancel(id));
  }

  /** Cancels any running job for this item and removes it from the queue. */
  remove(id: string): void {
    const item = this.queue.getState().items[id];
    if (item?.status === 'compressing') this.cancel(id);
    this.queue.getState().removeItem(id);
    this.pump();
  }

  clear(): void {
    this.cancelAll();
    this.queue.getState().clear();
  }

  retry(id: string): void {
    this.queue.getState().updateItem(id, { status: 'waiting', error: null, progress: null, stage: null });
    this.start();
  }

  private pump(): void {
    const queue = this.queue.getState();
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

    const after = this.queue.getState();
    const unsettled = after.order.some((id) => {
      const s = after.items[id]?.status;
      return s === 'waiting' || s === 'compressing';
    });
    if (!unsettled) after.setRunning(false);
  }

  private markStarted(item: QueueItem, stage: string): void {
    this.startedAt.set(item.id, performance.now());
    this.queue.getState().updateItem(item.id, {
      status: 'compressing',
      progress: null,
      stage,
      error: null,
    });
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
      settings: this.resolve.image(item),
      mode: this.mode,
      transform: this.resolve.transform?.(item),
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
        settings: this.resolve.image(item),
        mode: this.mode,
        transform: this.resolve.transform?.(item),
        support: this.imageSupport(),
        onStage: (stage) => {
          if (!this.cancelledMainThread.has(item.id)) this.queue.getState().updateItem(item.id, { stage });
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
      settings: this.resolve.video(item),
      mode: this.mode,
      output: this.resolve.videoOutput(item),
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
    const item = this.queue.getState().items[id];
    if (!item || item.status !== 'compressing') return;
    switch (msg.type) {
      case 'progress':
        this.queue.getState().updateItem(id, { progress: msg.progress, stage: msg.stage });
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
    const item = this.queue.getState().items[id];
    if (!item) return;
    const elapsedMs = performance.now() - (this.startedAt.get(id) ?? performance.now());
    this.startedAt.delete(id);

    let { width, height } = msg;
    let duration: number | undefined;
    if (item.kind === 'video') {
      if (msg.keptOriginal) {
        ({ width, height, duration } = item.meta);
      } else if (msg.mime.startsWith('image/')) {
        // Animated GIF made from a video.
        const probe = await probeImage(msg.blob);
        if (probe.thumbUrl) URL.revokeObjectURL(probe.thumbUrl);
        width ??= probe.meta.width;
        height ??= probe.meta.height;
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
      fileName:
        this.mode === 'convert'
          ? `${sanitizeBaseName(item.name)}.${extension}`
          : this.mode === 'resize'
            ? `${sanitizeBaseName(item.name)}-${width}x${height}.${extension}`
            : buildOutputName(item.name, extension, msg.keptOriginal),
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
    const current = this.queue.getState().items[id];
    if (!current || current.status !== 'compressing') {
      URL.revokeObjectURL(result.url);
      return;
    }
    this.queue.getState().updateItem(id, { status: 'completed', progress: 1, stage: null, result });
  }

  private fail(id: string, code: ErrorCode, detail: string, status: 'failed' | 'cancelled' = 'failed'): void {
    this.startedAt.delete(id);
    if (code !== 'CANCELLED') console.warn(`[CompressKit] ${code}:`, detail);
    this.queue.getState().updateItem(id, {
      status: code === 'CANCELLED' ? 'cancelled' : status,
      progress: null,
      stage: null,
      error: toFriendlyError(code),
    });
  }
}

export type { CompressionManager };

export const compressionManager = new CompressionManager('compress', useQueueStore, {
  image: (item) => item.override?.image ?? useSettingsStore.getState().image,
  video: (item) => item.override?.video ?? useSettingsStore.getState().video,
  videoOutput: () => ({ type: 'video' }),
});

export const conversionManager = new CompressionManager('convert', useConvertQueueStore, {
  image: () => convertImageSettings(useConvertSettingsStore.getState()),
  video: () => convertVideoSettings(useConvertSettingsStore.getState()),
  videoOutput: () => convertVideoOutput(useConvertSettingsStore.getState()),
});

export const resizeManager = new CompressionManager('resize', useResizeQueueStore, {
  image: () => resizeImageSettings(useResizeSettingsStore.getState()),
  // The resize tool accepts images only.
  video: () => convertVideoSettings(useConvertSettingsStore.getState()),
  videoOutput: () => ({ type: 'video' }),
  transform: (item) => resizeTransform(item, useResizeSettingsStore.getState()),
});
