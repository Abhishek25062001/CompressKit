// Downloads the background-removal models into models/ (not committed: about 200 MB together).
// Each file is pinned to one revision and checked against its SHA-256, so a build always ships
// exactly the models it was tested with. Run automatically before `npm run dev` and `npm run build`.
//
// Two models are shipped, and each browser downloads only one of them:
// - BiRefNet lite on the graphics card (WebGPU): clean, detailed edges. It needs several GB of
//   memory on the processor, more than WebAssembly can address, so it is GPU only.
// - IS-Net on the processor (WebAssembly), for browsers without WebGPU.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../models');

const SOURCES = {
  // BiRefNet lite (general use), exported to ONNX with fp16 weights by onnx-community. MIT licensed.
  birefnet: {
    url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model_fp16.onnx',
    sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402',
    size: 114538221,
    file: resolve(DIR, 'birefnet-lite-fp16.onnx'),
  },
  // IS-Net general use (DIS), exported to ONNX with fp16 weights by IMG.LY. MIT licensed.
  isnet: {
    url: 'https://huggingface.co/imgly/isnet-general-onnx/resolve/440dea96dd4a3b06bbbf5abec3e26569dd7ec49f/onnx/model_fp16.onnx',
    sha256: '2eb4b5dda7ec41c617e59706e5aafa1f978c9a5f983d2518d9f0ae4d6eb04f20',
    size: 88152708,
    file: resolve(DIR, 'isnet-general-fp16.onnx'),
  },
};

/** The files the app serves: `gpu` runs through WebGPU, `cpu` through WebAssembly. */
export const MODELS = {
  // BiRefNet rewritten so WebGPU can run every node (see patch-model.mjs).
  gpu: { name: 'birefnet', file: resolve(DIR, 'birefnet-lite-fp16-webgpu.onnx') },
  cpu: { name: 'isnet', file: SOURCES.isnet.file },
};

/** Records which download and which patch version the WebGPU model was made from. */
const GPU_STAMP = `${MODELS.gpu.file}.json`;

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(source) {
  if (existsSync(source.file) && (await sha256(source.file)) === source.sha256) return false;
  console.log(`Downloading ${source.file.split(/[/\\]/).pop()} (${(source.size / 1048576).toFixed(0)} MB)…`);
  mkdirSync(DIR, { recursive: true });
  const partial = `${source.file}.part`;
  try {
    const res = await fetch(source.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
    const actual = await sha256(partial);
    if (actual !== source.sha256) throw new Error(`checksum mismatch: got ${actual}`);
    renameSync(partial, source.file);
    return true;
  } finally {
    rmSync(partial, { force: true });
  }
}

async function gpuModelIsCurrent(PATCH_VERSION) {
  if (!existsSync(MODELS.gpu.file) || !existsSync(GPU_STAMP)) return false;
  try {
    const stamp = JSON.parse(readFileSync(GPU_STAMP, 'utf8'));
    return stamp.source === SOURCES.birefnet.sha256 && stamp.patch === PATCH_VERSION && stamp.sha256 === (await sha256(MODELS.gpu.file));
  } catch {
    return false;
  }
}

async function buildGpuModel() {
  const { patchForWebGpu, PATCH_VERSION } = await import('./patch-model.mjs');
  if (await gpuModelIsCurrent(PATCH_VERSION)) return;
  console.log('Preparing BiRefNet for WebGPU…');
  const bytes = patchForWebGpu(readFileSync(SOURCES.birefnet.file));
  const partial = `${MODELS.gpu.file}.part`;
  writeFileSync(partial, bytes);
  renameSync(partial, MODELS.gpu.file);
  const digest = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(GPU_STAMP, `${JSON.stringify({ source: SOURCES.birefnet.sha256, patch: PATCH_VERSION, sha256: digest }, null, 2)}\n`);
}

async function main() {
  // --optional (used by `npm run dev`) only warns, so the rest of the app still runs offline.
  const optional = process.argv.includes('--optional');
  const failures = [];
  const ready = new Set();
  for (const [name, source] of Object.entries(SOURCES)) {
    try {
      if (await download(source)) console.log('Model ready:', source.file);
      ready.add(name);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  if (ready.has('birefnet')) {
    try {
      await buildGpuModel();
    } catch (error) {
      // Never leave a stale or half-made WebGPU model behind for the build to ship.
      rmSync(MODELS.gpu.file, { force: true });
      rmSync(GPU_STAMP, { force: true });
      failures.push(`birefnet (WebGPU rewrite): ${error.message}`);
    }
  }
  if (failures.length === 0) return;
  const message = `Could not prepare the background-removal models:\n  ${failures.join('\n  ')}`;
  if (!optional) throw new Error(message);
  console.warn(`${message}\nThe background remover may not work until \`npm run model\` succeeds.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
