import type { VideoSettings } from '../../types/settings';
import { CompressionError } from '../../utils/errors';
import {
  audioBitsPerSecond,
  crfFor,
  estimateSourceVideoBitrate,
  outputMime,
  sourceBitrateCap,
  computeVideoSize,
  x26xPreset,
} from './videoParams';

/** The subset of the Emscripten module exported by @ffmpeg/core that CompressKit uses. */
interface FFmpegFS {
  mkdir(path: string): void;
  readdir(path: string): string[];
  readFile(path: string): Uint8Array;
  unlink(path: string): void;
  rmdir(path: string): void;
  mount(type: unknown, options: { files?: File[]; blobs?: { name: string; data: Blob }[] }, mountPoint: string): void;
  unmount(mountPoint: string): void;
  filesystems: { WORKERFS: unknown; MEMFS: unknown };
}

interface FFmpegCore {
  FS: FFmpegFS;
  exec(...args: string[]): number;
  setLogger(logger: (data: { type: string; message: string }) => void): void;
  setProgress(handler: (data: { progress: number; time: number }) => void): void;
  setTimeout(ms: number): void;
  reset(): void;
  ret: number;
}

type CreateCore = (options: Record<string, unknown>) => Promise<FFmpegCore>;

export interface FFmpegUrls {
  coreURL: string;
  wasmURL: string;
}

export type ProgressFn = (progress: number | null, stage: string) => void;

let corePromise: Promise<FFmpegCore> | null = null;

async function fetchWithProgress(url: string, onProgress: ProgressFn): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new CompressionError('ENGINE_LOAD_FAILED', `HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastReport = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    const now = performance.now();
    if (now - lastReport > 150) {
      lastReport = now;
      const mb = (loaded / 1048576).toFixed(1);
      onProgress(total ? loaded / total : null, total ? `Loading video engine (${mb} / ${(total / 1048576).toFixed(0)} MB)` : `Loading video engine (${mb} MB)`);
    }
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

/** Downloads (with real byte progress) and instantiates the FFmpeg core once per worker. */
function loadCore(urls: FFmpegUrls, onProgress: ProgressFn): Promise<FFmpegCore> {
  corePromise ??= (async () => {
    try {
      let wasmBytes: ArrayBuffer | null = await fetchWithProgress(urls.wasmURL, onProgress);
      onProgress(null, 'Starting video engine');
      const mod = (await import(/* @vite-ignore */ urls.coreURL)) as { default: CreateCore };
      const hash = btoa(JSON.stringify({ wasmURL: urls.wasmURL, workerURL: '' }));
      return await mod.default({
        mainScriptUrlOrBlob: `${urls.coreURL}#${hash}`,
        // Instantiate from the bytes we already downloaded, then drop our reference to them.
        instantiateWasm(
          imports: WebAssembly.Imports,
          done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
        ) {
          const bytes = wasmBytes;
          wasmBytes = null;
          if (!bytes) throw new Error('wasm bytes already consumed');
          WebAssembly.instantiate(bytes, imports).then(({ instance, module }) => done(instance, module));
          return {};
        },
      });
    } catch (e) {
      corePromise = null;
      if (e instanceof CompressionError) throw e;
      throw new CompressionError('ENGINE_LOAD_FAILED', String(e));
    }
  })();
  return corePromise;
}

function parseTimestamp(text: string): number | null {
  const m = /(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function scaleFilter(settings: VideoSettings, source?: { width?: number; height?: number }): string {
  const filters: string[] = [];
  if (settings.resolution !== 'original') {
    const t = settings.resolution;
    if (source?.width && source.height) {
      const size = computeVideoSize({ width: source.width, height: source.height }, settings.resolution);
      if (size.width !== source.width || size.height !== source.height) {
        filters.push(`scale=${size.width}:${size.height}:flags=lanczos`);
      }
    } else {
      // Short-side cap when the browser could not read the dimensions up front.
      filters.push(`scale='if(lte(iw,ih),min(iw,${t}),-2)':'if(lte(iw,ih),-2,min(ih,${t}))':flags=lanczos`);
    }
  }
  // 4:2:0 chroma subsampling needs even dimensions.
  filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  return filters.join(',');
}

/**
 * Encoder arguments. The @ffmpeg/core 0.12 build is single-threaded; in testing its libx265 hangs
 * and its libvpx-vp9 crashes, so only libx264 and libvpx (VP8) are used. VP9, H.265 and AV1 are
 * produced through WebCodecs when the browser supports them.
 */
function videoCodecArgs(settings: VideoSettings, maxrate: number | null): string[] {
  const crf = String(crfFor(settings.codec, settings.quality));
  const kbps = maxrate ? Math.round(maxrate / 1000) : null;
  switch (settings.codec) {
    case 'h264':
      return [
        '-c:v', 'libx264', '-preset', x26xPreset(settings.quality), '-crf', crf,
        '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        ...(kbps ? ['-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`] : []),
      ];
    case 'vp8':
      return [
        '-c:v', 'libvpx', '-crf', crf, '-b:v', kbps ? `${kbps}k` : '4M',
        '-deadline', 'good', '-cpu-used', '4', '-threads', '1', '-pix_fmt', 'yuv420p',
      ];
    default:
      throw new CompressionError('CODEC_UNSUPPORTED', `FFmpeg build has no encoder for ${settings.codec}`);
  }
}

export interface FFmpegJob {
  file: File;
  settings: VideoSettings;
  source: { width?: number; height?: number; duration?: number };
  urls: FFmpegUrls;
}

export interface EngineOutput {
  blob: Blob;
  mime: string;
  notes: string[];
}

/**
 * Transcodes with FFmpeg.wasm. The input is mounted with WORKERFS, so the source file is read
 * lazily from the File object instead of being copied into WebAssembly memory.
 */
export async function compressWithFFmpeg(job: FFmpegJob, onProgress: ProgressFn): Promise<EngineOutput> {
  const core = await loadCore(job.urls, onProgress);
  const { settings } = job;
  const mime = outputMime(settings);
  const ext = settings.container;
  const inputDir = '/input';
  const outputPath = `/out.${ext}`;
  // WORKERFS exposes the file by name; use a neutral name so user-supplied characters never reach the FS path.
  const dot = job.file.name.lastIndexOf('.');
  const inputName = `source${dot > 0 ? job.file.name.slice(dot).replace(/[^.\w]/g, '') : ''}`;
  const inputFile = new File([job.file], inputName, { type: job.file.type });

  let duration = job.source.duration ?? 0;
  const log: string[] = [];
  core.setLogger(({ message }) => {
    if (log.length > 400) log.shift();
    log.push(message);
    if (!duration && message.includes('Duration:')) {
      duration = parseTimestamp(message.split('Duration:')[1] ?? '') ?? 0;
    }
    const timeIdx = message.indexOf('time=');
    if (timeIdx >= 0) {
      const t = parseTimestamp(message.slice(timeIdx + 5));
      if (t !== null && duration > 0) {
        onProgress(Math.min(0.99, t / duration), 'Encoding with FFmpeg');
      } else {
        onProgress(null, 'Encoding with FFmpeg');
      }
    }
  });
  core.setProgress(() => undefined);

  const sourceBitrate = estimateSourceVideoBitrate(job.file.size, duration || undefined);
  const outSize =
    job.source.width && job.source.height
      ? computeVideoSize({ width: job.source.width, height: job.source.height }, settings.resolution)
      : undefined;
  const maxrate = outSize
    ? sourceBitrateCap({
        codec: settings.codec,
        quality: settings.quality,
        output: outSize,
        source: { width: job.source.width!, height: job.source.height! },
        sourceBitrate,
      })
    : sourceBitrate
      ? Math.round(sourceBitrate * 0.9)
      : null;

  const audioBps = audioBitsPerSecond(settings);
  const audioArgs =
    audioBps === null
      ? ['-an']
      : settings.container === 'mp4'
        ? ['-c:a', 'aac', '-b:a', `${audioBps / 1000}k`]
        : ['-c:a', 'libopus', '-b:a', `${audioBps / 1000}k`];

  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-i', `${inputDir}/${inputName}`,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', scaleFilter(settings, job.source),
    ...(settings.fps !== 'original' ? ['-fpsmax', String(settings.fps)] : []),
    ...videoCodecArgs(settings, maxrate),
    ...audioArgs,
    '-map_metadata', '-1',
    ...(settings.container === 'mp4' ? ['-movflags', '+faststart'] : []),
    outputPath,
  ];

  onProgress(null, 'Reading video');
  let mounted = false;
  try {
    try {
      core.FS.mkdir(inputDir);
    } catch {
      // Directory already exists from a previous job.
    }
    core.FS.mount(core.FS.filesystems.WORKERFS, { files: [inputFile] }, inputDir);
    mounted = true;

    let ret: number;
    try {
      core.setTimeout(-1);
      ret = core.exec(...args);
    } finally {
      core.reset();
    }

    if (ret !== 0) {
      const tail = log.slice(-25).join('\n');
      const lower = tail.toLowerCase();
      if (lower.includes('cannot allocate memory') || lower.includes('out of memory')) {
        throw new CompressionError('OUT_OF_MEMORY', tail);
      }
      if (
        lower.includes('invalid data found') ||
        lower.includes('could not find codec parameters') ||
        lower.includes('does not contain any stream') ||
        lower.includes('moov atom not found')
      ) {
        throw new CompressionError('DECODE_FAILED', tail);
      }
      if (lower.includes('stream map') && lower.includes('matches no streams')) {
        throw new CompressionError('NO_VIDEO_TRACK', tail);
      }
      if (lower.includes('decoder') && lower.includes('not found')) {
        throw new CompressionError('CODEC_UNSUPPORTED', tail);
      }
      throw new CompressionError('UNKNOWN', `ffmpeg exited with ${ret}\n${tail}`);
    }

    onProgress(1, 'Finalizing');
    const data = core.FS.readFile(outputPath);
    const blob = new Blob([data as BlobPart], { type: mime });
    return { blob, mime, notes: [] };
  } finally {
    try {
      core.FS.unlink(outputPath);
    } catch {
      // Output was never created.
    }
    if (mounted) {
      try {
        core.FS.unmount(inputDir);
      } catch {
        // Ignore: the worker is discarded on failure anyway.
      }
    }
  }
}
