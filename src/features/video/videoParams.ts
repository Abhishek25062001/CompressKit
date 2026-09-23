import type { VideoCodecId, VideoResolution, VideoSettings } from '../../types/settings';

export interface Dimensions {
  width: number;
  height: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Output dimensions for a short-side cap ("1080p" means the short side becomes 1080).
 * Never upscales, keeps aspect ratio and returns even numbers, which 4:2:0 encoders require.
 */
export function computeVideoSize(source: Dimensions, resolution: VideoResolution): Dimensions {
  const shortSide = Math.min(source.width, source.height);
  const scale = resolution === 'original' || shortSide <= resolution ? 1 : resolution / shortSide;
  return { width: even(source.width * scale), height: even(source.height * scale) };
}

/** x264 CRF for a 1..100 quality value: 85 → 20, 70 → 24, 45 → 29. */
function baseCrf(quality: number): number {
  return Math.min(40, Math.max(16, Math.round(40 - quality * 0.235)));
}

export function crfFor(codec: VideoCodecId, quality: number): number {
  const base = baseCrf(quality);
  switch (codec) {
    case 'h265':
      return Math.min(51, base + 4);
    case 'vp9':
    case 'av1':
      return Math.min(63, Math.round(base * 1.4));
    case 'vp8':
      return Math.min(63, Math.max(4, Math.round(base * 1.3)));
    default:
      return base;
  }
}

/** Slower presets compress better; single-threaded WebAssembly makes "medium" costly, so it is reserved for small-file mode. */
export function x26xPreset(quality: number): string {
  return quality <= 50 ? 'medium' : 'faster';
}

const CODEC_EFFICIENCY: Record<VideoCodecId, number> = {
  h264: 1,
  h265: 0.7,
  vp9: 0.7,
  av1: 0.55,
  vp8: 1.1,
};

/** Bits per pixel per frame for H.264, growing with quality: 45 → ~0.036, 70 → ~0.067, 85 → ~0.096. */
function bitsPerPixel(quality: number): number {
  return 0.012 * Math.exp(0.0245 * quality);
}

/** Share of the source bitrate the output may use. Keeps outputs smaller than inputs that are already efficient. */
function sourceShare(quality: number): number {
  return Math.min(0.95, Math.max(0.4, 0.25 + quality * 0.0075));
}

export interface BitrateInput {
  codec: VideoCodecId;
  quality: number;
  output: Dimensions;
  source?: Dimensions;
  fps: number;
  /** Estimated bitrate of the source video stream in bits per second. */
  sourceBitrate?: number;
}

/** Target bitrate for bitrate-driven encoders (WebCodecs). */
export function targetVideoBitrate(input: BitrateInput): number {
  const pixelsPerSecond = input.output.width * input.output.height * Math.max(1, input.fps);
  let bitrate = pixelsPerSecond * bitsPerPixel(input.quality) * CODEC_EFFICIENCY[input.codec];
  const cap = sourceBitrateCap(input);
  if (cap) bitrate = Math.min(bitrate, cap);
  return Math.max(150_000, Math.round(bitrate));
}

/** Upper bound derived from the source bitrate, scaled by the pixel reduction. */
export function sourceBitrateCap(input: Omit<BitrateInput, 'fps'>): number | null {
  if (!input.sourceBitrate || !Number.isFinite(input.sourceBitrate)) return null;
  const pixelRatio =
    input.source && input.source.width && input.source.height
      ? Math.min(1, (input.output.width * input.output.height) / (input.source.width * input.source.height))
      : 1;
  return Math.max(150_000, Math.round(input.sourceBitrate * sourceShare(input.quality) * pixelRatio));
}

/** Rough video-only bitrate of a file: total size over duration minus a typical audio track. */
export function estimateSourceVideoBitrate(fileSize: number, duration?: number): number | undefined {
  if (!duration || duration <= 0) return undefined;
  const total = (fileSize * 8) / duration;
  return Math.max(200_000, total - 128_000);
}

export function audioBitsPerSecond(settings: VideoSettings): number | null {
  return settings.audioBitrate === 'remove' ? null : settings.audioBitrate * 1000;
}

export function outputMime(settings: VideoSettings): string {
  return settings.container === 'mp4' ? 'video/mp4' : 'video/webm';
}

export const CODEC_LABEL: Record<VideoCodecId, string> = {
  h264: 'H.264',
  h265: 'H.265 / HEVC',
  vp9: 'VP9',
  vp8: 'VP8',
  av1: 'AV1',
};

export const CONTAINER_CODECS: Record<VideoSettings['container'], VideoCodecId[]> = {
  mp4: ['h264', 'h265', 'av1'],
  webm: ['vp9', 'vp8', 'av1'],
};
