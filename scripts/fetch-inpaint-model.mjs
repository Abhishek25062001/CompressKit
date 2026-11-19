// Downloads the LaMa inpainting models into models/ (not committed).
// Each file is pinned to one revision and checked against its SHA-256.
//
// Two builds of the same 512×512 graph (g-ronimo/lama), so only one is downloaded per browser:
// - lama_512_fp16 on WebGPU: FFT replaced with matmuls so the whole graph stays on the GPU.
// - lama_512_int8 on WebAssembly: smaller and faster on CPU/WASM.
//
// Source: LaMa (Suvorov et al., Apache-2.0). ONNX export: g-ronimo/lama (Apache-2.0).
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../models');

const SOURCES = {
  // Full fp16 compute, fixed 512×512, FFT as matmuls — recommended for WebGPU.
  gpu: {
    url: 'https://huggingface.co/g-ronimo/lama/resolve/386a67cedf9b8bb4fe76798c10c8d77abc0a5cc8/lama_512_fp16.onnx',
    sha256: '1fa042eaf30a6660b9190f0a1512d27bdceff90fab172af295303cdf2905e516',
    size: 106559381,
    file: resolve(DIR, 'lama-512-fp16.onnx'),
  },
  // Weight-only int8 on the same graph — recommended for WASM/CPU.
  cpu: {
    url: 'https://huggingface.co/g-ronimo/lama/resolve/386a67cedf9b8bb4fe76798c10c8d77abc0a5cc8/lama_512_int8.onnx',
    sha256: 'cab19978adc306622fe37ef60d4a52103b99c98141d499c2a2366a7ed1255dbe',
    size: 62074990,
    file: resolve(DIR, 'lama-512-int8.onnx'),
  },
};

/** The files the app serves: `gpu` for WebGPU, `cpu` for WebAssembly. */
export const INPAINT_MODELS = {
  gpu: { name: 'lama-fp16', file: SOURCES.gpu.file },
  cpu: { name: 'lama-int8', file: SOURCES.cpu.file },
};

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(source) {
  if (existsSync(source.file) && (await sha256(source.file)) === source.sha256) return false;
  console.log(`Downloading ${source.file.split(/[/\\]/).pop()} (~${(source.size / 1048576).toFixed(0)} MB)…`);
  mkdirSync(DIR, { recursive: true });
  const partial = `${source.file}.part`;
  try {
    const res = await fetch(source.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
    const actual = await sha256(partial);
    if (actual !== source.sha256) throw new Error(`checksum mismatch: got ${actual}`);
    renameSync(partial, source.file);
    console.log(`Model ready: ${source.file}`);
    return true;
  } finally {
    rmSync(partial, { force: true });
  }
}

export async function fetchInpaintModels({ optional = false } = {}) {
  const failures = [];
  for (const [key, source] of Object.entries(SOURCES)) {
    try {
      if (await download(source)) console.log('Inpaint model ready:', source.file);
    } catch (error) {
      failures.push(`${key}: ${error.message}`);
    }
  }
  if (failures.length === 0) return;
  const message = `Could not prepare the inpainting models:\n  ${failures.join('\n  ')}`;
  if (!optional) throw new Error(message);
  console.warn(`${message}\nWatermark removal will fall back to the classical fill until \`npm run model:inpaint\` succeeds.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const optional = process.argv.includes('--optional');
  await fetchInpaintModels({ optional });
}
