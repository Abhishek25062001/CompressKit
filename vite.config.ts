import { readFileSync } from 'node:fs';
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

// CompressKit is a fully static, client-side app. No server code, no env vars.
export default defineConfig({
  plugins: [react(), tailwindcss(), selfHostedOcr()],
  worker: {
    // Module workers let the video worker dynamically import the FFmpeg core.
    format: 'es',
  },
  optimizeDeps: {
    // These packages locate their .wasm files relative to import.meta.url,
    // which breaks if Vite pre-bundles them.
    exclude: ['@ffmpeg/core', '@jsquash/avif'],
  },
  build: {
    target: 'es2022',
    // The FFmpeg core (~32 MB wasm) is an asset that is only fetched on demand.
    chunkSizeWarningLimit: 1200,
  },
});
