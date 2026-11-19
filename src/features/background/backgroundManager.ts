import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import backgroundModels from 'virtual:background-model';
import { MIME_EXTENSION, MIME_LABEL } from '../../constants/formats';
import { useBackgroundSettingsStore } from '../../store/backgroundSettingsStore';
import type { QueueStore } from '../../store/queueStore';
import type { BackgroundJobRequest, GpuFailedMessage, ModelFiles } from '../../types/background';
import type { QueueItem } from '../../types/media';
import type { WorkerResponse } from '../../types/worker';
import { CompressionError } from '../../utils/errors';
import { sanitizeBaseName } from '../../utils/filename';
import { WorkerSlot } from '../compression/workerSlot';
import { QueueRunner, type ProcessOutput, type ProgressFn } from '../compression/queueRunner';
import { beginRun, MEMLOG, printMemTable, recordMain, recordSample, type MemlogMessage } from './memlog';

/**
 * Sizes in bytes of the AI models, one of which the first photo downloads: `gpu` for browsers with
 * WebGPU, `cpu` for the rest. Null when this deployment does not include that model.
 */
export const MODEL_BYTES = { gpu: backgroundModels.gpu?.size ?? null, cpu: backgroundModels.cpu?.size ?? null };

const absolute = (path: string) => new URL(path, new URL(import.meta.env.BASE_URL, window.location.href)).href;

const withAbsoluteUrls = (model: ModelFiles | null): ModelFiles | null => model && { ...model, parts: model.parts.map(absolute) };

/** Shown on results made by the processor model after the graphics card failed. */
const FALLBACK_NOTE =
  'Your graphics card could not run the detailed AI model, so the lighter one ran on the processor, which is slower and softer at the edges.';

/** Idle time before the worker is terminated, which frees ONNX Runtime's WebAssembly heap (it never shrinks otherwise). */
const IDLE_EXIT_MS = 45_000;

/** Memlog messages are routed by the slot to `onAside` and never reach `onMessage`. */
type BackgroundWorkerMessage = WorkerResponse | GpuFailedMessage;

/**
 * ONNX Runtime options. Threads only take effect on a cross-origin isolated page. In development,
 * `localStorage['ofctools-bg-runtime']` may override them for memory benchmarks, for example
 * `{"threads":2,"memArena":true,"memPattern":true}`.
 */
function runtimeOptions(): Pick<BackgroundJobRequest['runtime'], 'threads' | 'memArena' | 'memPattern'> {
  const options = { threads: 4, memArena: false, memPattern: false };
  if (!MEMLOG) return options;
  try {
    const override = JSON.parse(localStorage.getItem('ofctools-bg-runtime') ?? '{}') as Partial<typeof options>;
    return { ...options, ...override };
  } catch {
    return options;
  }
}

/**
 * Runs the background remover's queue: one photo at a time on one worker, which keeps the model
 * loaded between photos and exits 45 s after the last one.
 */
export class BackgroundManager extends QueueRunner {
  private slot = new WorkerSlot(
    () => new Worker(new URL('../../workers/background.worker.ts', import.meta.url), { type: 'module', name: 'compresskit-background' }),
    IDLE_EXIT_MS,
  );

  /** Settles the promise of the running job when it is cancelled, since its worker is gone. */
  private cancelRunning: (() => void) | null = null;

  /** Set once the graphics card failed in this page; later photos go straight to the processor. */
  private gpuDisabled = false;

  private idleLog: ReturnType<typeof setTimeout> | null = null;

  constructor(queue: QueueStore) {
    super(queue, 1);
    if (MEMLOG) {
      this.slot.onAside = (message) => recordSample((message as MemlogMessage).sample);
      this.slot.onIdleExit = () => recordMain('worker terminated (idle 45 s)', 'worker gone: its WASM heap and GPU buffers are freed');
    }
  }

  protected override abort(id: string): void {
    if (this.slot.jobId !== id) return;
    this.slot.terminate();
    this.cancelRunning?.();
  }

  protected override process(item: QueueItem, onProgress: ProgressFn): Promise<ProcessOutput> {
    if (!backgroundModels.gpu && !backgroundModels.cpu) {
      return Promise.reject(new CompressionError('ENGINE_LOAD_FAILED', 'models not included in this build (run `npm run model`)'));
    }
    if (MEMLOG) {
      if (this.idleLog) clearTimeout(this.idleLog);
      beginRun(item.name, item.file.size);
    }
    return this.attempt(item, onProgress, this.gpuDisabled).then((out) => {
      if (MEMLOG) {
        // Let the worker's 'after cleanup' sample arrive, then print; log again after 60 s idle.
        setTimeout(printMemTable, 500);
        this.idleLog = setTimeout(() => {
          recordMain('60 s idle', this.slot.busy ? 'worker busy' : 'no worker running');
          printMemTable();
        }, 60_000);
      }
      return out;
    });
  }

  private attempt(item: QueueItem, onProgress: ProgressFn, forceCpu: boolean): Promise<ProcessOutput> {
    const settings = { ...useBackgroundSettingsStore.getState() };
    const request: BackgroundJobRequest = {
      type: 'remove-background',
      jobId: item.id,
      file: item.file,
      settings: {
        background: settings.background,
        color: settings.color,
        format: settings.format,
        trim: settings.trim,
        debugMatte: settings.debugMatte,
      },
      models: { gpu: withAbsoluteUrls(backgroundModels.gpu), cpu: withAbsoluteUrls(backgroundModels.cpu) },
      runtime: { wasm: new URL(ortWasmUrl, window.location.href).href, ...runtimeOptions() },
      forceCpu,
    };
    return new Promise((resolve, reject) => {
      this.cancelRunning = () => reject(new CompressionError('CANCELLED'));
      this.slot.run<BackgroundWorkerMessage>(item.id, request, {
        onMessage: (msg) => {
          if (msg.type === 'progress') onProgress(msg.progress, msg.stage);
          else if (msg.type === 'error') reject(new CompressionError(msg.code, msg.detail));
          else if (msg.type === 'gpu-failed') {
            console.info('[ofctools] The graphics card could not run the background model, using the processor:', msg.detail);
            this.gpuDisabled = true;
            // A fresh worker: nothing the graphics card attempt allocated survives.
            this.slot.terminate();
            resolve(
              this.attempt(item, onProgress, true).then((out) => ({
                ...out,
                result: { ...out.result, notes: [FALLBACK_NOTE, ...out.result.notes] },
              })),
            );
          } else {
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
                debugPreviews: msg.debug
                  ? {
                      rawMatteUrl: URL.createObjectURL(msg.debug.rawMatte),
                      refinedMatteUrl: URL.createObjectURL(msg.debug.refinedMatte),
                      onWhiteUrl: URL.createObjectURL(msg.debug.onWhite),
                      onBlackUrl: URL.createObjectURL(msg.debug.onBlack),
                      onColorUrl: URL.createObjectURL(msg.debug.onColor),
                    }
                  : undefined,
              },
            });
          }
        },
        onCrash: (detail) => reject(new CompressionError('WORKER_CRASHED', detail)),
      });
    });
  }
}
