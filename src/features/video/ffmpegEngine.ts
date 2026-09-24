import type { AudioTarget } from '../../types/convert';
import type { VideoSettings } from '../../types/settings';
import type { TimeRange } from '../../types/trim';
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
  /** Only encode this part of the source (trim tool). */
  trim?: TimeRange;
}

export interface EngineOutput {
  blob: Blob;
  mime: string;
  notes: string[];
}

interface RunOptions {
  file: File;
  urls: FFmpegUrls;
  duration?: number;
  outputExt: string;
  mime: string;
  /** Returns one argument list per FFmpeg pass. Progress is split evenly between passes. */
  passes: (inputPath: string, outputPath: string) => string[][];
  /** Intermediate files the passes create, removed afterwards. */
  scratch?: string[];
  stage: string;
}

function classifyFailure(log: string[], ret: number): CompressionError {
  const tail = log.slice(-25).join('\n');
  const lower = tail.toLowerCase();
  if (lower.includes('cannot allocate memory') || lower.includes('out of memory')) {
    return new CompressionError('OUT_OF_MEMORY', tail);
  }
  if (lower.includes('stream map') && lower.includes('matches no streams')) {
    return new CompressionError(lower.includes("'0:a") ? 'NO_AUDIO_TRACK' : 'NO_VIDEO_TRACK', tail);
  }
  if (
    lower.includes('invalid data found') ||
    lower.includes('could not find codec parameters') ||
    lower.includes('does not contain any stream') ||
    lower.includes('moov atom not found')
  ) {
    return new CompressionError('DECODE_FAILED', tail);
  }
  if (lower.includes('decoder') && lower.includes('not found')) {
    return new CompressionError('CODEC_UNSUPPORTED', tail);
  }
  return new CompressionError('UNKNOWN', `ffmpeg exited with ${ret}\n${tail}`);
}

/**
 * Runs FFmpeg.wasm. The input is mounted with WORKERFS, so the source file is read lazily from the
 * File object instead of being copied into WebAssembly memory.
 */
async function runFFmpeg(opts: RunOptions, onProgress: ProgressFn): Promise<EngineOutput> {
  const core = await loadCore(opts.urls, onProgress);
  const inputDir = '/input';
  const outputPath = `/out.${opts.outputExt}`;
  // WORKERFS exposes the file by name; use a neutral name so user-supplied characters never reach the FS path.
  const dot = opts.file.name.lastIndexOf('.');
  const inputName = `source${dot > 0 ? opts.file.name.slice(dot).replace(/[^.\w]/g, '') : ''}`;
  const inputFile = new File([opts.file], inputName, { type: opts.file.type });
  const passes = opts.passes(`${inputDir}/${inputName}`, outputPath);

  let duration = opts.duration ?? 0;
  let pass = 0;
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
        onProgress(Math.min(0.99, (pass + Math.min(1, t / duration)) / passes.length), opts.stage);
      } else {
        onProgress(null, opts.stage);
      }
    }
  });
  core.setProgress(() => undefined);

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

    for (pass = 0; pass < passes.length; pass++) {
      let ret: number;
      try {
        core.setTimeout(-1);
        ret = core.exec(...passes[pass]);
      } finally {
        core.reset();
      }
      if (ret !== 0) throw classifyFailure(log, ret);
    }

    onProgress(1, 'Finalizing');
    const data = core.FS.readFile(outputPath);
    const blob = new Blob([data as BlobPart], { type: opts.mime });
    return { blob, mime: opts.mime, notes: [] };
  } finally {
    for (const path of [outputPath, ...(opts.scratch ?? [])]) {
      try {
        core.FS.unlink(path);
      } catch {
        // File was never created.
      }
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

/** Re-encodes to MP4 (H.264) or WebM (VP8). */
export async function compressWithFFmpeg(job: FFmpegJob, onProgress: ProgressFn): Promise<EngineOutput> {
  const { settings, trim } = job;
  const sourceBitrate = estimateSourceVideoBitrate(job.file.size, job.source.duration || undefined);
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

  return runFFmpeg(
    {
      file: job.file,
      urls: job.urls,
      duration: trim ? trim.end - trim.start : job.source.duration,
      outputExt: settings.container,
      mime: outputMime(settings),
      stage: 'Encoding with FFmpeg',
      passes: (input, output) => [
        [
          '-hide_banner', '-nostdin', '-y',
          // Seeking before the input is frame-accurate when re-encoding, and skips decoding what comes before.
          ...(trim ? ['-ss', trim.start.toFixed(3), '-t', (trim.end - trim.start).toFixed(3)] : []),
          '-i', input,
          '-map', '0:v:0', '-map', '0:a:0?',
          '-vf', scaleFilter(settings, job.source),
          ...(settings.fps !== 'original' ? ['-fpsmax', String(settings.fps)] : []),
          ...videoCodecArgs(settings, maxrate),
          ...audioArgs,
          '-map_metadata', '-1',
          ...(settings.container === 'mp4' ? ['-movflags', '+faststart'] : []),
          output,
        ],
      ],
    },
    onProgress,
  );
}

export interface ConvertJob {
  file: File;
  source: { duration?: number };
  urls: FFmpegUrls;
}

/**
 * Animated GIF in two passes: the first builds a 256-color palette tuned to this clip, the second
 * maps frames onto it. A single-pass split would hold every decoded frame in memory until the end.
 */
export function convertToGif(
  job: ConvertJob,
  gif: { width: number | null; fps: number },
  onProgress: ProgressFn,
): Promise<EngineOutput> {
  const palette = '/palette.png';
  const scale = gif.width ? `,scale='min(${gif.width},iw)':-1:flags=lanczos` : '';
  const base = `fps=${gif.fps}${scale}`;
  return runFFmpeg(
    {
      file: job.file,
      urls: job.urls,
      duration: job.source.duration,
      outputExt: 'gif',
      mime: 'image/gif',
      stage: 'Creating GIF',
      scratch: [palette],
      passes: (input, output) => [
        ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', '-vf', `${base},palettegen=stats_mode=diff`, palette],
        [
          '-hide_banner', '-nostdin', '-y', '-i', input, '-i', palette,
          '-lavfi', `[0:v:0]${base}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
          '-loop', '0', output,
        ],
      ],
    },
    onProgress,
  );
}

const AUDIO_ARGS: Record<AudioTarget, { mime: string; args: string[] }> = {
  mp3: { mime: 'audio/mpeg', args: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  m4a: { mime: 'audio/mp4', args: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] },
  wav: { mime: 'audio/wav', args: ['-c:a', 'pcm_s16le'] },
};

/** Extracts the first audio track into an audio-only file. */
export function convertToAudio(job: ConvertJob, format: AudioTarget, onProgress: ProgressFn): Promise<EngineOutput> {
  const { mime, args } = AUDIO_ARGS[format];
  return runFFmpeg(
    {
      file: job.file,
      urls: job.urls,
      duration: job.source.duration,
      outputExt: format,
      mime,
      stage: 'Extracting audio',
      passes: (input, output) => [
        ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:a:0', '-vn', ...args, '-map_metadata', '-1', output],
      ],
    },
    onProgress,
  );
}
