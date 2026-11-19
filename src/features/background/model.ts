import type * as Ort from 'onnxruntime-web';
import type { BackgroundJobRequest, ModelFiles } from '../../types/background';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import { MODEL_INPUT_SIZE } from './matte';
import { memlog, withPeakSampling } from './memlog';

export type Device = 'webgpu' | 'wasm';

/** Both models look at the photo squeezed into a 1024 × 1024 square (ONNX I/O). */
export const MASK_SIZE = MODEL_INPUT_SIZE;

interface Engine {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  device: Device;
}

interface ModelSpec {
  /** Per-channel mean and spread of the 0–255 pixel values, as the model was trained. */
  mean: readonly [number, number, number];
  std: readonly [number, number, number];
  /** Soft float alpha 0–1 (no binary threshold). */
  toAlpha(values: Float32Array): Float32Array;
}

/** BiRefNet outputs logits; their sigmoid is the chance that a pixel belongs to the subject. */
function fromLogits(values: Float32Array): Float32Array {
  const alpha = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) alpha[i] = 1 / (1 + Math.exp(-values[i]));
  return alpha;
}

/** IS-Net outputs a foreground map, stretched so its weakest and strongest values span 0–1 (as in its reference code). */
function stretched(values: Float32Array): Float32Array {
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
  const alpha = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) alpha[i] = (values[i] - min) / range;
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

/** Model parts are content-addressed (their folder carries the model hash), so they never go stale. */
export const MODEL_CACHE = 'ofctools-models-v1';

/** Thrown when the graphics card cannot start or run the model; the page retries on the processor in a fresh worker. */
export class GpuFailedError extends Error {}

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(MODEL_CACHE);
  } catch {
    return null;
  }
}

/**
 * The model file as one buffer. Parts come from Cache Storage when all are there (checked when they
 * were stored), otherwise from the network, checked against the SHA-256 and then cached. The caller
 * must drop the buffer once the session is created.
 */
async function loadModelBytes(model: ModelFiles, onProgress: ProgressFn): Promise<Uint8Array<ArrayBuffer>> {
  const cache = await openCache();
  const cached = cache ? await Promise.all(model.parts.map((url) => cache.match(url))) : [];
  const fromCache = cache !== null && cached.every((r) => r?.ok);
  const bytes = new Uint8Array(model.size);
  let loaded = 0;
  let lastReport = 0;
  for (const [i, url] of model.parts.entries()) {
    let res: Response;
    if (fromCache) {
      res = cached[i]!;
    } else {
      res = await fetch(url);
      if (!res.ok || !res.body) throw new CompressionError('ENGINE_LOAD_FAILED', `HTTP ${res.status} for ${url}`);
      if (cache) void cache.put(url, res.clone()).catch(() => undefined);
    }
    if (!res.body) throw new CompressionError('ENGINE_LOAD_FAILED', `empty body for ${url}`);
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > bytes.length) throw new CompressionError('ENGINE_LOAD_FAILED', 'model larger than expected');
      bytes.set(value, loaded);
      loaded += value.length;
      const now = performance.now();
      if (!fromCache && now - lastReport > 150) {
        lastReport = now;
        onProgress(loaded / model.size, `Downloading AI model (${(loaded / MB).toFixed(0)} / ${(model.size / MB).toFixed(0)} MB)`);
      }
    }
  }
  if (loaded !== model.size) throw new CompressionError('ENGINE_LOAD_FAILED', `model truncated: ${loaded} of ${model.size} bytes`);
  if (!fromCache) {
    onProgress(null, 'Checking AI model');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== model.sha256) {
      if (cache) await Promise.all(model.parts.map((url) => cache.delete(url))).catch(() => undefined);
      throw new CompressionError('ENGINE_LOAD_FAILED', `model checksum mismatch: ${hex}`);
    }
  }
  memlog('model fetch', { 'model bytes': bytes.byteLength }, fromCache ? 'from Cache Storage' : 'downloaded');
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
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(job.runtime.threads, navigator.hardwareConcurrency || 1)) : 1;
  ort.env.logLevel = 'error';
  return ort;
}

/**
 * Creates the session from `model`'s bytes. The bytes live only inside this function: once
 * `create` has copied them into ONNX Runtime they are unreachable and the garbage collector frees them.
 */
async function createSession(ort: typeof Ort, job: BackgroundJobRequest, model: ModelFiles, device: Device, onProgress: ProgressFn): Promise<Engine> {
  // The bytes are only a parameter of this callback, never a variable of the awaiting function.
  const session = await loadModelBytes(model, onProgress).then((bytes) => {
    onProgress(null, 'Starting AI model');
    return ort.InferenceSession.create(bytes, {
      executionProviders: [device],
      // Arena and memory-pattern planning keep freed CPU tensors around for reuse; without them the
      // WebAssembly heap peaks lower at a small cost in speed.
      enableCpuMemArena: job.runtime.memArena,
      enableMemPattern: job.runtime.memPattern,
    });
  });
  memlog('session create', {}, `${device}; arena ${job.runtime.memArena ? 'on' : 'off'}, mem pattern ${job.runtime.memPattern ? 'on' : 'off'}, threads ${ort.env.wasm.numThreads}`);
  return { ort, session, device };
}

let engine: Promise<Engine> | null = null;

/**
 * The worker's one session, created on first use: BiRefNet on the graphics card when the browser
 * offers a suitable one (a few seconds per photo), otherwise IS-Net on the processor (about a
 * minute per photo). A graphics card that cannot start the model throws GpuFailedError, so the page
 * can retry in a fresh worker and nothing the failed attempt allocated stays alive.
 */
function getEngine(job: BackgroundJobRequest, onProgress: ProgressFn): Promise<Engine> {
  engine ??= (async () => {
    const ort = await loadRuntime(job);
    if (!job.forceCpu && job.models.gpu && (await gpuCanRunModel())) {
      try {
        return await createSession(ort, job, job.models.gpu, 'webgpu', onProgress);
      } catch (error) {
        // A failed download is reported as it is; only a graphics card that cannot run the model falls back.
        if (error instanceof CompressionError) throw error;
        throw new GpuFailedError(String(error));
      }
    }
    if (!job.models.cpu) throw new CompressionError('ENGINE_LOAD_FAILED', 'no processor model in this build');
    return createSession(ort, job, job.models.cpu, 'wasm', onProgress);
  })().catch((error: unknown) => {
    engine = null;
    if (error instanceof GpuFailedError || error instanceof CompressionError) throw error;
    throw new CompressionError('ENGINE_LOAD_FAILED', String(error));
  });
  return engine;
}

/** Releases the session (its GPU buffers and tensors). The next photo creates it again from the cache. */
export async function releaseEngine(): Promise<boolean> {
  const current = engine;
  engine = null;
  inputData = null;
  if (!current) return false;
  try {
    await (await current).session.release();
  } catch {
    // Never started, or already gone.
  }
  return true;
}

/** Reused between photos: 3 × 1024 × 1024 floats (12 MB). */
let inputData: Float32Array<ArrayBuffer> | null = null;

/** RGBA pixels as three planes of normalized floats, the layout both models take. */
function toTensorData(rgba: Uint8ClampedArray, { mean, std }: ModelSpec): Float32Array<ArrayBuffer> {
  const plane = MASK_SIZE * MASK_SIZE;
  const out = (inputData ??= new Float32Array(3 * plane));
  for (let i = 0; i < plane; i++) {
    out[i] = (rgba[i * 4] - mean[0]) / std[0];
    out[plane + i] = (rgba[i * 4 + 1] - mean[1]) / std[1];
    out[2 * plane + i] = (rgba[i * 4 + 2] - mean[2]) / std[2];
  }
  return out;
}

async function predict({ ort, session, device }: Engine, rgba: Uint8ClampedArray): Promise<Float32Array> {
  const spec = SPECS[device];
  const data = toTensorData(rgba, spec);
  const input = new ort.Tensor('float32', data, [1, 3, MASK_SIZE, MASK_SIZE]);
  memlog('before inference', { 'input tensor': data.byteLength, 'letterboxed RGBA': rgba.byteLength });
  try {
    const results = await withPeakSampling({ 'input tensor': data.byteLength }, () => session.run({ [session.inputNames[0]]: input }));
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
  /** MASK_SIZE × MASK_SIZE soft alpha, 0–1 (letterboxed square). */
  alpha: Float32Array;
  device: Device;
}

/** Finds the subject in the photo, given as MASK_SIZE × MASK_SIZE RGBA pixels. */
export async function findSubject(job: BackgroundJobRequest, rgba: Uint8ClampedArray, onProgress: ProgressFn): Promise<SubjectMask> {
  const current = await getEngine(job, onProgress);
  if (current.device === 'webgpu') {
    onProgress(null, 'Finding the subject');
    try {
      return { alpha: await predict(current, rgba), device: 'webgpu' };
    } catch (error) {
      // A driver or memory problem on the graphics card: the page retries on the processor in a fresh worker.
      throw new GpuFailedError(String(error));
    }
  }
  onProgress(null, 'Finding the subject (no GPU, this takes about a minute)');
  return { alpha: await predict(current, rgba), device: 'wasm' };
}
