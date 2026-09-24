// Downloads the background-removal model into models/ (not committed: it is 88 MB).
// The file is pinned to one revision and checked against its SHA-256, so a build always ships
// exactly the model it was tested with. Run automatically before `npm run dev` and `npm run build`.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const MODEL = {
  // IS-Net general use (DIS), exported to ONNX with fp16 weights by IMG.LY. MIT licensed.
  url: 'https://huggingface.co/imgly/isnet-general-onnx/resolve/440dea96dd4a3b06bbbf5abec3e26569dd7ec49f/onnx/model_fp16.onnx',
  sha256: '2eb4b5dda7ec41c617e59706e5aafa1f978c9a5f983d2518d9f0ae4d6eb04f20',
  size: 88152708,
  file: resolve(dirname(fileURLToPath(import.meta.url)), '../models/isnet-general-fp16.onnx'),
};

async function sha256(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function main() {
  // --optional (used by `npm run dev`) only warns, so the rest of the app still runs offline.
  const optional = process.argv.includes('--optional');
  if (existsSync(MODEL.file) && (await sha256(MODEL.file)) === MODEL.sha256) return;

  console.log(`Downloading background-removal model (${(MODEL.size / 1048576).toFixed(0)} MB)…`);
  mkdirSync(dirname(MODEL.file), { recursive: true });
  const partial = `${MODEL.file}.part`;
  try {
    const res = await fetch(MODEL.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial));
    const actual = await sha256(partial);
    if (actual !== MODEL.sha256) throw new Error(`checksum mismatch: got ${actual}`);
    renameSync(partial, MODEL.file);
    console.log('Model ready:', MODEL.file);
  } catch (error) {
    rmSync(partial, { force: true });
    const message = `Could not download the background-removal model: ${error.message}`;
    if (!optional) throw new Error(message);
    console.warn(`${message}\nThe background remover will not work until \`npm run model\` succeeds.`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
