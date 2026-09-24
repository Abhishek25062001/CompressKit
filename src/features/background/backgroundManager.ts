import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import backgroundModel from 'virtual:background-model';
import { MIME_EXTENSION, MIME_LABEL } from '../../constants/formats';
import { useBackgroundSettingsStore } from '../../store/backgroundSettingsStore';
import type { QueueStore } from '../../store/queueStore';
import type { BackgroundJobRequest } from '../../types/background';
import type { QueueItem } from '../../types/media';
import type { WorkerResponse } from '../../types/worker';
import { CompressionError } from '../../utils/errors';
import { sanitizeBaseName } from '../../utils/filename';
import { WorkerSlot } from '../compression/workerSlot';
import { QueueRunner, type ProcessOutput, type ProgressFn } from '../compression/queueRunner';

/** Size of the AI model the first photo downloads, in bytes. Null when this deployment has none. */
export const MODEL_BYTES = backgroundModel?.size ?? null;

const absolute = (path: string) => new URL(path, new URL(import.meta.env.BASE_URL, window.location.href)).href;

/**
 * Runs the background remover's queue: one photo at a time on one worker, which keeps the model
 * loaded between photos and for a few minutes after the last one.
 */
export class BackgroundManager extends QueueRunner {
  private slot = new WorkerSlot(
    () => new Worker(new URL('../../workers/background.worker.ts', import.meta.url), { type: 'module', name: 'compresskit-background' }),
    5 * 60_000,
  );

  /** Settles the promise of the running job when it is cancelled, since its worker is gone. */
  private cancelRunning: (() => void) | null = null;

  constructor(queue: QueueStore) {
    super(queue, 1);
  }

  protected override abort(id: string): void {
    if (this.slot.jobId !== id) return;
    this.slot.terminate();
    this.cancelRunning?.();
  }

  protected override process(item: QueueItem, onProgress: ProgressFn): Promise<ProcessOutput> {
    if (!backgroundModel) {
      return Promise.reject(new CompressionError('ENGINE_LOAD_FAILED', 'model not included in this build (run `npm run model`)'));
    }
    const settings = { ...useBackgroundSettingsStore.getState() };
    const request: BackgroundJobRequest = {
      type: 'remove-background',
      jobId: item.id,
      file: item.file,
      settings: { background: settings.background, color: settings.color, format: settings.format, trim: settings.trim },
      model: { parts: backgroundModel.parts.map(absolute), size: backgroundModel.size, sha256: backgroundModel.sha256 },
      runtime: { wasm: new URL(ortWasmUrl, window.location.href).href },
    };
    return new Promise((resolve, reject) => {
      this.cancelRunning = () => reject(new CompressionError('CANCELLED'));
      this.slot.run<WorkerResponse>(item.id, request, {
        onMessage: (msg) => {
          if (msg.type === 'progress') onProgress(msg.progress, msg.stage);
          else if (msg.type === 'error') reject(new CompressionError(msg.code, msg.detail));
          else {
            const ext = MIME_EXTENSION[msg.mime] ?? 'png';
            resolve({
              result: {
                blob: msg.blob,
                fileName: `${sanitizeBaseName(item.name)}-cutout.${ext}`,
                mime: msg.mime,
                formatLabel: MIME_LABEL[msg.mime] ?? ext.toUpperCase(),
                size: msg.blob.size,
                width: msg.width,
                height: msg.height,
                engine: msg.engine === 'webgpu' ? 'webgpu' : 'wasm',
                notes: msg.notes,
                keptOriginal: false,
              },
            });
          }
        },
        onCrash: (detail) => reject(new CompressionError('WORKER_CRASHED', detail)),
      });
    });
  }
}
