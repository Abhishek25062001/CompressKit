import type * as Ort from 'onnxruntime-web';
import type { BackgroundJobRequest, ModelFiles } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';

export type Device = 'webgpu' | 'wasm';

/** Both models look at the photo squeezed into a 1024 × 1024 square. */
export const MASK_SIZE = 1024;

interface Engine {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  device: Device;
}

interface ModelSpec {
  /** Per-channel mean and spread of the 0–255 pixel values, as the model was trained. */
  mean: readonly [number, number, number];
  std: readonly [number, number, number];
  /** The model's output as alpha values, 0–255. */
  toAlpha(values: Float32Array): Uint8ClampedArray;
}

/** BiRefNet outputs logits; their sigmoid is the chance that a pixel belongs to the subject. */
function fromLogits(values: Float32Array): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(values.length);
  for (let i = 0; i < values.length; i++) alpha[i] = 255 / (1 + Math.exp(-values[i]));
  return alpha;
}

/** IS-Net outputs a foreground map, stretched so its weakest and strongest values span 0–255 (as in its reference code). */
function stretched(values: Float32Array): Uint8ClampedArray {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Stretch only a real foreground map; a nearly flat one (no subject) is used as it is.
  if (max - min < 0.2) {
    min = 0;
    max = 1;
  }
  const range = max - min;
  const alpha = new Uint8ClampedArray(values.length);
  for (let i = 0; i < values.length; i++) alpha[i] = ((values[i] - min) / range) * 255;
  return alpha;
}

/**
 * On the graphics card: BiRefNet lite, which finds clean, detailed edges and leaves shadows and
 * nearby objects out. It needs several GB of memory on the processor, more than WebAssembly can use,
 * so the processor runs IS-Net: lighter, but softer at the edges.
 */
const SPECS: Record<Device, ModelSpec> = {
  webgpu: { mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], toAlpha: fromLogits },
  wasm: { mean: [128, 128, 128], std: [256, 256, 256], toAlpha: stretched },
};

const MB = 1048576;

/** Downloads the model parts in order with byte progress, joins them and checks the result. */
async function download(model: ModelFiles, onProgress: ProgressFn): Promise<Uint8Array<ArrayBuffer>> {
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

/** BiRefNet computes in 16-bit floats, which the graphics card must support (WebGPU's `shader-f16`). */
async function gpuCanRunModel(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: ReadonlySet<string> } | null> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter())?.features.has('shader-f16') ?? false;
  } catch {
    return false;
  }
}

async function loadRuntime(job: BackgroundJobRequest): Promise<typeof Ort> {
  const ort = await import('onnxruntime-web/all');
  ort.env.wasm.wasmPaths = { wasm: job.runtime.wasm };
  // Threads need a cross-origin isolated page, which a plain static host does not provide.
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  ort.env.logLevel = 'error';
  return ort;
}

async function startSession(ort: typeof Ort, bytes: Uint8Array, device: Device, onProgress: ProgressFn): Promise<Engine> {
  onProgress(null, 'Starting AI model');
  const session = await ort.InferenceSession.create(bytes, { executionProviders: [device] });
  return { ort, session, device };
}

let engine: Promise<Engine> | null = null;
/** Set once the graphics card could not start or run BiRefNet, so later photos go straight to the processor. */
let gpuFailed = false;

/**
 * Loads a model once per worker: BiRefNet on the graphics card when the browser offers a suitable
 * one (a few seconds per photo), otherwise IS-Net on the processor (about a minute per photo).
 */
function getEngine(job: BackgroundJobRequest, onProgress: ProgressFn): Promise<Engine> {
  engine ??= (async () => {
    const ort = await loadRuntime(job);
    if (!gpuFailed && job.models.gpu && (await gpuCanRunModel())) {
      // A failed download is reported as it is; only a graphics card that cannot run the model falls back.
      const bytes = await download(job.models.gpu, onProgress);
      try {
        return await startSession(ort, bytes, 'webgpu', onProgress);
      } catch (error) {
        gpuFailed = true;
        console.info('[CompressKit] The graphics card could not start the background model, using the processor:', error);
      }
    }
    if (!job.models.cpu) throw new CompressionError('ENGINE_LOAD_FAILED', 'no processor model in this build');
    return startSession(ort, await download(job.models.cpu, onProgress), 'wasm', onProgress);
  })().catch((error: unknown) => {
    engine = null;
    throw error instanceof CompressionError ? error : new CompressionError('ENGINE_LOAD_FAILED', String(error));
  });
  return engine;
}

/** RGBA pixels as three planes of normalized floats, the layout both models take. */
function toTensorData(rgba: Uint8ClampedArray, { mean, std }: ModelSpec): Float32Array {
  const plane = MASK_SIZE * MASK_SIZE;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    out[i] = (rgba[i * 4] - mean[0]) / std[0];
    out[plane + i] = (rgba[i * 4 + 1] - mean[1]) / std[1];
    out[2 * plane + i] = (rgba[i * 4 + 2] - mean[2]) / std[2];
  }
  return out;
}

async function predict({ ort, session, device }: Engine, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray> {
  const spec = SPECS[device];
  const input = new ort.Tensor('float32', toTensorData(rgba, spec), [1, 3, MASK_SIZE, MASK_SIZE]);
  try {
    const results = await session.run({ [session.inputNames[0]]: input });
    const output = results[session.outputNames[0]];
    try {
      return spec.toAlpha((await output.getData()) as Float32Array);
    } finally {
      output.dispose();
    }
  } finally {
    input.dispose();
  }
}

export interface SubjectMask {
  /** MASK_SIZE × MASK_SIZE alpha values, 0–255: how much each pixel belongs to the subject. */
  alpha: Uint8ClampedArray;
  device: Device;
  notes: string[];
}

const FALLBACK_NOTE = 'Your graphics card could not run the detailed AI model, so the lighter one ran on the processor, which is slower and softer at the edges.';

/** Finds the subject in the photo, given as MASK_SIZE × MASK_SIZE RGBA pixels. */
export async function findSubject(job: BackgroundJobRequest, rgba: Uint8ClampedArray, onProgress: ProgressFn): Promise<SubjectMask> {
  let current = await getEngine(job, onProgress);
  if (current.device === 'webgpu') {
    onProgress(null, 'Finding the subject');
    try {
      return { alpha: await predict(current, rgba), device: 'webgpu', notes: [] };
    } catch (error) {
      // A driver or memory problem on the graphics card: the processor can still do it.
      console.info('[CompressKit] The graphics card failed on the background model, using the processor:', error);
      gpuFailed = true;
      engine = null;
      void current.session.release().catch(() => undefined);
      current = await getEngine(job, onProgress);
    }
  }
  onProgress(null, 'Finding the subject (no GPU, this takes about a minute)');
  return { alpha: await predict(current, rgba), device: 'wasm', notes: gpuFailed ? [FALLBACK_NOTE] : [] };
}
