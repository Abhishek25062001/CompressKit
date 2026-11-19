/**
 * LaMa 512×512 ONNX inpainting via onnxruntime-web.
 *
 * Inspected tensors (g-ronimo/lama lama_512_fp16 / lama_512_int8):
 * - input  float32 [1, 4, 512, 512]  — RGB 0–1 with hole zeroed, then mask channel (1 = fill)
 * - output float32 [1, 3, 512, 512]  — RGB 0–1
 */
import type * as Ort from 'onnxruntime-web';
import type { ModelFiles } from '../../types/background';
import type { WatermarkJobRequest } from '../../types/watermark';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../compression/queueRunner';
import { LAMA_SIZE, reflectIndex, squarePad } from './geometry';

export type Device = 'webgpu' | 'wasm';

interface Engine {
  ort: typeof Ort;
  session: Ort.InferenceSession;
  device: Device;
  inputName: string;
  outputName: string;
}

const MB = 1048576;

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
        onProgress(loaded / model.size, `Downloading inpaint model (${(loaded / MB).toFixed(0)} / ${(model.size / MB).toFixed(0)} MB)`);
      }
    }
  }
  if (loaded !== model.size) throw new CompressionError('ENGINE_LOAD_FAILED', `model truncated: ${loaded} of ${model.size} bytes`);
  onProgress(null, 'Checking inpaint model');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== model.sha256) throw new CompressionError('ENGINE_LOAD_FAILED', `model checksum mismatch: ${hex}`);
  return bytes;
}

async function gpuCanRun(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function loadRuntime(job: WatermarkJobRequest): Promise<typeof Ort> {
  if (!job.runtime) throw new CompressionError('ENGINE_LOAD_FAILED', 'ONNX runtime URL missing');
  const ort = await import('onnxruntime-web/all');
  ort.env.wasm.wasmPaths = { wasm: job.runtime.wasm };
  ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  ort.env.logLevel = 'error';
  return ort;
}

async function startSession(ort: typeof Ort, bytes: Uint8Array, device: Device, onProgress: ProgressFn): Promise<Engine> {
  onProgress(null, 'Starting inpaint model');
  const session = await ort.InferenceSession.create(bytes, { executionProviders: [device] });
  const inputName = session.inputNames.find((n) => n === 'input') ?? session.inputNames[0];
  const outputName = session.outputNames.find((n) => n === 'output') ?? session.outputNames[0];
  if (!inputName || !outputName) throw new CompressionError('ENGINE_LOAD_FAILED', 'LaMa model has no input/output names');
  return { ort, session, device, inputName, outputName };
}

let engine: Promise<Engine> | null = null;
let gpuFailed = false;

function getEngine(job: WatermarkJobRequest, onProgress: ProgressFn): Promise<Engine> {
  if (!job.models) throw new CompressionError('ENGINE_LOAD_FAILED', 'inpaint models missing');
  engine ??= (async () => {
    const ort = await loadRuntime(job);
    if (!gpuFailed && job.models!.gpu && (await gpuCanRun())) {
      const bytes = await download(job.models!.gpu, onProgress);
      try {
        return await startSession(ort, bytes, 'webgpu', onProgress);
      } catch (error) {
        gpuFailed = true;
        console.info('[ofctools] WebGPU could not start LaMa, using WASM:', error);
      }
    }
    if (!job.models!.cpu) throw new CompressionError('ENGINE_LOAD_FAILED', 'no WASM inpaint model in this build');
    return startSession(ort, await download(job.models!.cpu, onProgress), 'wasm', onProgress);
  })().catch((error: unknown) => {
    engine = null;
    throw error instanceof CompressionError ? error : new CompressionError('ENGINE_LOAD_FAILED', String(error));
  });
  return engine;
}

/** Whether this build can attempt LaMa (at least one model was shipped). */
export function lamaAvailable(job: WatermarkJobRequest): boolean {
  return !!(job.models?.gpu || job.models?.cpu);
}

/**
 * Build LaMa's 4-channel input from a crop: reflect-pad to square, resize to 512,
 * RGB 0–1 with hole zeroed, mask in channel 3.
 */
export function buildLamaInput(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  srcW: number,
  srcH: number,
): Float32Array {
  const { side, padX, padY } = squarePad(srcW, srcH);
  const plane = LAMA_SIZE * LAMA_SIZE;
  const out = new Float32Array(4 * plane);

  for (let y = 0; y < LAMA_SIZE; y++) {
    for (let x = 0; x < LAMA_SIZE; x++) {
      // Map model pixel → padded square → source (with reflect outside the crop).
      const sqX = ((x + 0.5) * side) / LAMA_SIZE - 0.5;
      const sqY = ((y + 0.5) * side) / LAMA_SIZE - 0.5;
      const srcXf = sqX - padX;
      const srcYf = sqY - padY;
      const sx = reflectIndex(Math.round(srcXf), srcW);
      const sy = reflectIndex(Math.round(srcYf), srcH);
      const si = sy * srcW + sx;
      const m = mask[si] ? 1 : 0;
      const o = y * LAMA_SIZE + x;
      const base = si * 4;
      // Hole zeroed on RGB; mask channel is 1 where we fill.
      out[o] = m ? 0 : rgba[base] / 255;
      out[plane + o] = m ? 0 : rgba[base + 1] / 255;
      out[2 * plane + o] = m ? 0 : rgba[base + 2] / 255;
      out[3 * plane + o] = m;
    }
  }
  return out;
}

/** Resize LaMa RGB 0–1 output back to the crop size (bilinear). */
export function lamaOutputToCrop(rgb01: Float32Array, srcW: number, srcH: number): Uint8ClampedArray {
  const { side, padX, padY } = squarePad(srcW, srcH);
  const plane = LAMA_SIZE * LAMA_SIZE;
  const out = new Uint8ClampedArray(srcW * srcH * 4);

  const sample = (fx: number, fy: number, ch: number): number => {
    const x = Math.min(LAMA_SIZE - 1, Math.max(0, fx));
    const y = Math.min(LAMA_SIZE - 1, Math.max(0, fy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(LAMA_SIZE - 1, x0 + 1);
    const y1 = Math.min(LAMA_SIZE - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const i00 = ch * plane + y0 * LAMA_SIZE + x0;
    const i10 = ch * plane + y0 * LAMA_SIZE + x1;
    const i01 = ch * plane + y1 * LAMA_SIZE + x0;
    const i11 = ch * plane + y1 * LAMA_SIZE + x1;
    return rgb01[i00] * (1 - tx) * (1 - ty) + rgb01[i10] * tx * (1 - ty) + rgb01[i01] * (1 - tx) * ty + rgb01[i11] * tx * ty;
  };

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const sqX = x + padX;
      const sqY = y + padY;
      const mx = ((sqX + 0.5) * LAMA_SIZE) / side - 0.5;
      const my = ((sqY + 0.5) * LAMA_SIZE) / side - 0.5;
      const o = (y * srcW + x) * 4;
      // Output documented as 0–1; clamp in case a build returns 0–255.
      const scale = (v: number) => {
        const n = v > 1.5 ? v / 255 : v;
        return Math.round(Math.min(1, Math.max(0, n)) * 255);
      };
      out[o] = scale(sample(mx, my, 0));
      out[o + 1] = scale(sample(mx, my, 1));
      out[o + 2] = scale(sample(mx, my, 2));
      out[o + 3] = 255;
    }
  }
  return out;
}

export interface LamaResult {
  rgba: Uint8ClampedArray;
  device: Device;
  notes: string[];
}

/** Run LaMa on a crop (RGBA + binary mask). */
export async function runLama(
  job: WatermarkJobRequest,
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  onProgress: ProgressFn,
): Promise<LamaResult> {
  let current = await getEngine(job, onProgress);
  const notes: string[] = [];
  const inputData = buildLamaInput(rgba, mask, width, height);

  const predict = async (eng: Engine) => {
    onProgress(null, eng.device === 'webgpu' ? 'Inpainting (GPU)' : 'Inpainting');
    const tensor = new eng.ort.Tensor('float32', inputData, [1, 4, LAMA_SIZE, LAMA_SIZE]);
    try {
      const results = await eng.session.run({ [eng.inputName]: tensor });
      const output = results[eng.outputName];
      try {
        const data = (await output.getData()) as Float32Array;
        return lamaOutputToCrop(data, width, height);
      } finally {
        output.dispose();
      }
    } finally {
      tensor.dispose();
    }
  };

  try {
    if (current.device === 'webgpu') {
      try {
        return { rgba: await predict(current), device: 'webgpu', notes };
      } catch (error) {
        console.info('[ofctools] WebGPU LaMa failed, using WASM:', error);
        gpuFailed = true;
        engine = null;
        void current.session.release().catch(() => undefined);
        current = await getEngine(job, onProgress);
        notes.push('Your graphics card could not run the inpaint model, so the processor model was used.');
      }
    }
    return { rgba: await predict(current), device: current.device, notes };
  } catch (error) {
    throw error instanceof CompressionError ? error : new CompressionError('ENGINE_LOAD_FAILED', String(error));
  }
}
