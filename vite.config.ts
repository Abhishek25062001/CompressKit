import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { CATALOG, HOME_META, SITE_NAME } from './src/features/catalog';

const require = createRequire(import.meta.url);

/**
 * Text recognition (OCR) files, served from this site at fixed paths: Tesseract looks for its
 * core by directory and picks the build the browser supports, and loads language data by name.
 * Only the LSTM cores are shipped, since that is the only engine mode ofctools uses.
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
 * The background-removal models, served from this site in parts of at most 20 MB so they fit the
 * per-file limits of static hosts. Part names carry each model's hash, so they can be cached forever.
 * The app imports the part lists from `virtual:background-model`. `npm run model` prepares the files.
 */
const MODEL_PART_BYTES = 20 * 1024 * 1024;

interface ServedModel {
  file: string;
  size: number;
  sha256: string;
  parts: { fileName: string; start: number; end: number }[];
}

function describeModel(name: string, file: string): ServedModel {
  const bytes = readFileSync(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const count = Math.ceil(bytes.length / MODEL_PART_BYTES);
  const parts = Array.from({ length: count }, (_, i) => ({
    fileName: `models/${name}-${sha256.slice(0, 12)}/part-${String(i + 1).padStart(2, '0')}.bin`,
    start: i * MODEL_PART_BYTES,
    end: Math.min(bytes.length, (i + 1) * MODEL_PART_BYTES),
  }));
  return { file, size: bytes.length, sha256, parts };
}

function readRange(file: string, start: number, end: number): Buffer {
  const fd = openSync(file, 'r');
  try {
    const bytes = Buffer.alloc(end - start);
    readSync(fd, bytes, 0, bytes.length, start);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function selfHostedModel(): Plugin {
  const virtualId = 'virtual:background-model';
  const resolvedId = `\0${virtualId}`;
  const models: Record<'gpu' | 'cpu', ServedModel | null> = { gpu: null, cpu: null };

  return {
    name: 'compresskit-background-model',
    // While Remove Background is off this takes no `config`; add it back with the line below.
    async configResolved() {
      const { MODELS } = await import('./scripts/fetch-model.mjs');
      for (const key of ['gpu', 'cpu'] as const) {
        const { name, file } = MODELS[key];
        if (existsSync(file)) models[key] = describeModel(name, file);
        // Remove Background is switched off for now, so a build no longer needs the models.
        // else if (config.command === 'build') throw new Error(`Background-removal model missing (${file}): run \`npm run model\`.`);
      }
    },
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id) {
      if (id !== resolvedId) return undefined;
      const info = (m: ServedModel | null) => (m ? { parts: m.parts.map((p) => p.fileName), size: m.size, sha256: m.sha256 } : null);
      return `export default ${JSON.stringify({ gpu: info(models.gpu), cpu: info(models.cpu) })};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        for (const model of [models.gpu, models.cpu]) {
          const part = model?.parts.find((p) => p.fileName === path);
          if (!model || !part) continue;
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(readRange(model.file, part.start, part.end));
          return;
        }
        next();
      });
    },
    // Remove Background is switched off for now, so the models (about 200 MB) are left out of
    // dist/ and the phone app. Uncomment to ship them again.
    // generateBundle() {
    //   for (const model of [models.gpu, models.cpu]) {
    //     if (!model) continue;
    //     const bytes = readFileSync(model.file);
    //     for (const part of model.parts) {
    //       this.emitFile({ type: 'asset', fileName: part.fileName, source: bytes.subarray(part.start, part.end) });
    //     }
    //   }
    // },
  };
}

/**
 * Fixes a bug in ONNX Runtime Web 1.30 (microsoft/onnxruntime#32731): when GatherND data has more
 * than four dimensions, its WebGPU shader reads a packed uniform array (array<vec4<u32>>) as if it
 * were flat, and the browser rejects the shader. BiRefNet has such GatherNDs. If the code no longer
 * matches, the build fails so an ONNX Runtime update gets checked; remove this once a release has the fix.
 */
function onnxRuntimeGatherNdFix(): Plugin {
  const fixes = [
    {
      pattern: /\$\{(\w+)\.length===1\?"index \+= i32\(uniforms\.input_dims\);":"index \+= i32\(uniforms\.input_dims\[input_dim_idx\]\);"\}/,
      fix: (n: string) =>
        `\${${n}.length===1?"index += i32(uniforms.input_dims);":${n}.length>4?"index += i32(uniforms.input_dims[input_dim_idx / 4u][input_dim_idx % 4u]);":"index += i32(uniforms.input_dims[input_dim_idx]);"}`,
    },
    {
      pattern:
        /\$\{(\w+)\.length===1\?"relative_slice_offset \+= index \* i32\(uniforms\.sizes_from_slice_dims_data\);":"relative_slice_offset \+= index \* i32\(uniforms\.sizes_from_slice_dims_data\[dim_idx\]\);"\}/,
      fix: (n: string) =>
        `\${${n}.length===1?"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data);":${n}.length>4?"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data[dim_idx / 4u][dim_idx % 4u]);":"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data[dim_idx]);"}`,
    },
  ];
  return {
    name: 'compresskit-onnxruntime-gathernd-fix',
    transform(code, id) {
      if (!/\/onnxruntime-web\/dist\/ort\.all\.bundle\.min\.mjs(\?|$)/.test(id)) return undefined;
      let out = code;
      for (const { pattern, fix } of fixes) {
        const match = pattern.exec(out);
        if (!match) {
          throw new Error('onnxruntime-web changed: check whether microsoft/onnxruntime#32731 is fixed, then update or remove onnxRuntimeGatherNdFix in vite.config.ts.');
        }
        out = out.replace(pattern, () => fix(match[1]));
      }
      return { code: out, map: null };
    },
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Sets the page title and every description or title meta tag in an HTML document. */
function withMeta(html: string, title: string, description: string): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta\s+(?:name|property)="(?:og:title|twitter:title)"\s+content=")[^"]*"/g, `$1${t}"`)
    .replace(/(<meta\s+(?:name|property)="(?:description|og:description|twitter:description)"\s+content=")[^"]*"/g, `$1${d}"`);
}

/**
 * Writes an HTML page for each tool address (dist/compress/index.html, …) with that tool's title
 * and description, so links and search results show the right text before any script runs, and
 * the site works on any static host without rewrite rules. 404.html serves unknown addresses.
 */
function toolPages(): Plugin {
  let outDir = 'dist';
  return {
    name: 'compresskit-tool-pages',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    transformIndexHtml(html) {
      return withMeta(html, HOME_META.title, HOME_META.description);
    },
    writeBundle() {
      const index = readFileSync(join(outDir, 'index.html'), 'utf8');
      for (const tool of CATALOG) {
        const dir = join(outDir, tool.path.slice(1));
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'index.html'), withMeta(index, tool.title, tool.description));
      }
      writeFileSync(join(outDir, '404.html'), withMeta(index, `Page not found | ${SITE_NAME}`, HOME_META.description));
    },
  };
}

// ofctools is a fully static, client-side app. No server code, no env vars.
export default defineConfig({
  plugins: [react(), tailwindcss(), selfHostedOcr(), selfHostedModel(), onnxRuntimeGatherNdFix(), toolPages()],
  worker: {
    // Module workers let the video worker dynamically import the FFmpeg core.
    format: 'es',
    // The background worker bundles ONNX Runtime, so its fix must apply there too.
    plugins: () => [onnxRuntimeGatherNdFix()],
  },
  server: {
    // The React Native project in app/ holds gigabytes of native build output and a copy of this
    // site's own build; none of it belongs to the dev server.
    watch: { ignored: ['**/app/ofctools/**'] },
  },
  optimizeDeps: {
    // Only this site's own page is scanned for dependencies, not the copy of the build in app/.
    entries: ['index.html'],
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
