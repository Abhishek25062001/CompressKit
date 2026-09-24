import type * as Ort from 'onnxruntime-web';
import type { BackgroundJobRequest } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';

export type Device = 'webgpu' | 'wasm';

export interface LoadedModel {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  device: Device;
}

const MB = 1048576;

/** Downloads the model parts in order with byte progress, joins them and checks the result. */
async function download(model: BackgroundJobRequest['model'], onProgress: ProgressFn): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(model.size);
  let loaded = 0;
  let lastReport = 0;
  for (const url of model.parts) {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new CompressionError('ENGINE_LOAD_FAILED', `HTTP ${res.status} for ${url}`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > bytes.length) throw new CompressionError('ENGINE_LOAD_FAILED', 'model larger than expected');
      bytes.set(value, loaded);
      loaded += value.length;
      const now = performance.now();
      if (now - lastReport > 150) {
        lastReport = now;
        onProgress(loaded / model.size, `Downloading AI model (${(loaded / MB).toFixed(0)} / ${(model.size / MB).toFixed(0)} MB)`);
      }
    }
  }
  if (loaded !== model.size) throw new CompressionError('ENGINE_LOAD_FAILED', `model truncated: ${loaded} of ${model.size} bytes`);
  onProgress(null, 'Checking AI model');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== model.sha256) throw new CompressionError('ENGINE_LOAD_FAILED', `model checksum mismatch: ${hex}`);
  return bytes;
}

async function gpuAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

let loading: Promise<LoadedModel> | null = null;

/**
 * Loads the model once per worker: on the GPU through WebGPU when the browser offers it (about a
 * second per photo), otherwise on the CPU through WebAssembly (about a minute per photo).
 */
export function loadModel(job: BackgroundJobRequest, onProgress: ProgressFn): Promise<LoadedModel> {
  loading ??= (async () => {
    try {
      const ort = await import('onnxruntime-web/all');
      ort.env.wasm.wasmPaths = { wasm: job.runtime.wasm };
      // Threads need a cross-origin isolated page, which a plain static host does not provide.
      ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      ort.env.logLevel = 'error';
      const bytes = await download(job.model, onProgress);
      onProgress(null, 'Starting AI model');
      if (await gpuAvailable()) {
        try {
          const session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
          return { ort, session, device: 'webgpu' as const };
        } catch (error) {
          console.info('[CompressKit] WebGPU unavailable for the background model, using WebAssembly:', error);
        }
      }
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
      return { ort, session, device: 'wasm' as const };
    } catch (error) {
      loading = null;
      if (error instanceof CompressionError) throw error;
      throw new CompressionError('ENGINE_LOAD_FAILED', String(error));
    }
  })();
  return loading;
}
