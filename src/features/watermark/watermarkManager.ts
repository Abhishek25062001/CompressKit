import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import inpaintModels from 'virtual:inpaint-model';
import { MIME_EXTENSION, MIME_LABEL } from '../../constants/formats';
import { useWatermarkSettingsStore } from '../../store/watermarkSettingsStore';
import type { QueueStore } from '../../store/queueStore';
import type { ModelFiles } from '../../types/background';
import type { QueueItem } from '../../types/media';
import type { WatermarkJobRequest } from '../../types/watermark';
import type { WorkerResponse } from '../../types/worker';
import { CompressionError } from '../../utils/errors';
import { sanitizeBaseName } from '../../utils/filename';
import { WorkerSlot } from '../compression/workerSlot';
import { QueueRunner, type ProcessOutput, type ProgressFn } from '../compression/queueRunner';
import { resolveMaskRect } from './maskRect';

export { DEFAULT_WATERMARK_MASK, resolveMaskRect } from './maskRect';

/** Byte sizes of the LaMa models this build can download (null when not shipped). */
export const INPAINT_MODEL_BYTES = {
  gpu: inpaintModels.gpu?.size ?? null,
  cpu: inpaintModels.cpu?.size ?? null,
};

const absolute = (path: string) => new URL(path, new URL(import.meta.env.BASE_URL, window.location.href)).href;
const withAbsoluteUrls = (model: ModelFiles | null): ModelFiles | null =>
  model && { ...model, parts: model.parts.map(absolute) };

/**
 * Runs the watermark remover's queue: one photo at a time on one worker (keeps LaMa loaded).
 */
export class WatermarkManager extends QueueRunner {
  private slot = new WorkerSlot(
    () => new Worker(new URL('../../workers/watermark.worker.ts', import.meta.url), { type: 'module', name: 'compresskit-watermark' }),
    5 * 60_000,
  );

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
    const { rect, usedDefault } = resolveMaskRect(item);
    const settings = useWatermarkSettingsStore.getState();
    const request: WatermarkJobRequest = {
      type: 'remove-watermark',
      jobId: item.id,
      file: item.file,
      mask: rect,
      settings: { format: settings.format, expand: settings.expand, debugMask: settings.debugMask },
      models: { gpu: withAbsoluteUrls(inpaintModels.gpu), cpu: withAbsoluteUrls(inpaintModels.cpu) },
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
            const notes = [...msg.notes];
            if (usedDefault) notes.unshift('Used the default bottom-right mark. Open Mark watermark to aim it.');
            const engine = msg.engine === 'webgpu' || msg.engine === 'wasm' ? msg.engine : 'canvas';
            resolve({
              result: {
                blob: msg.blob,
                fileName: `${sanitizeBaseName(item.name)}-clean.${ext}`,
                mime: msg.mime,
                formatLabel: MIME_LABEL[msg.mime] ?? ext.toUpperCase(),
                size: msg.blob.size,
                width: msg.width,
                height: msg.height,
                engine,
                notes,
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
