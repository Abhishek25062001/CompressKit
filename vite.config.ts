import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);

/**
 * Text recognition (OCR) files, served from this site at fixed paths: Tesseract looks for its
 * core by directory and picks the build the browser supports, and loads language data by name.
 * Only the LSTM cores are shipped, since that is the only engine mode CompressKit uses.
 */
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': 'tesseract.js/dist/worker.min.js',
  'ocr/core/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/core/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  // "best_int" English: accurate and about 3 MB compressed.
  'ocr/lang/eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

function selfHostedOcr(): Plugin {
  const resolve = (published: string) => require.resolve(OCR_FILES[published]);
  return {
    name: 'compresskit-self-hosted-ocr',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        if (!(path in OCR_FILES)) return next();
        res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(resolve(path)));
      });
    },
    generateBundle() {
      for (const fileName of Object.keys(OCR_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolve(fileName)) });
      }
    },
  };
}

/**
 * The background-removal model, served from this site in parts of at most 20 MB so it fits the
 * per-file limits of static hosts. Part names carry the model's hash, so they can be cached forever.
 * The app imports the part list from `virtual:background-model`. `npm run model` downloads the file.
 */
const MODEL_PART_BYTES = 20 * 1024 * 1024;

function selfHostedModel(): Plugin {
  const virtualId = 'virtual:background-model';
  const resolvedId = `\0${virtualId}`;
  let parts: { fileName: string; start: number; end: number }[] = [];
  let model: { sha256: string; size: number; file: string } | null = null;
  let isBuild = false;

  return {
    name: 'compresskit-background-model',
    async configResolved(config) {
      isBuild = config.command === 'build';
      const { MODEL } = await import('./scripts/fetch-model.mjs');
      if (!existsSync(MODEL.file)) {
        if (isBuild) throw new Error('Background-removal model missing: run `npm run model`.');
        return;
      }
      model = MODEL;
      const count = Math.ceil(MODEL.size / MODEL_PART_BYTES);
      parts = Array.from({ length: count }, (_, i) => ({
        fileName: `models/isnet-${MODEL.sha256.slice(0, 12)}/part-${String(i + 1).padStart(2, '0')}.bin`,
        start: i * MODEL_PART_BYTES,
        end: Math.min(MODEL.size, (i + 1) * MODEL_PART_BYTES),
      }));
    },
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id) {
      if (id !== resolvedId) return undefined;
      const info = model ? { parts: parts.map((p) => p.fileName), size: model.size, sha256: model.sha256 } : null;
      return `export default ${JSON.stringify(info)};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        const part = parts.find((p) => p.fileName === path);
        if (!part || !model) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(readFileSync(model.file).subarray(part.start, part.end));
      });
    },
    generateBundle() {
      if (!model) return;
      const bytes = readFileSync(model.file);
      for (const part of parts) {
        this.emitFile({ type: 'asset', fileName: part.fileName, source: bytes.subarray(part.start, part.end) });
      }
    },
  };
}

// CompressKit is a fully static, client-side app. No server code, no env vars.
export default defineConfig({
  plugins: [react(), tailwindcss(), selfHostedOcr(), selfHostedModel()],
  worker: {
    // Module workers let the video worker dynamically import the FFmpeg core.
    format: 'es',
  },
  optimizeDeps: {
    // These packages locate their .wasm files relative to import.meta.url,
    // which breaks if Vite pre-bundles them.
    exclude: ['@ffmpeg/core', '@jsquash/avif', 'onnxruntime-web'],
  },
  build: {
    target: 'es2022',
    // The FFmpeg core (~32 MB wasm) is an asset that is only fetched on demand.
    chunkSizeWarningLimit: 1200,
  },
});
