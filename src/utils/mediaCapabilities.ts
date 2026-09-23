import type { VideoCodecId } from '../types/settings';

export interface ImageEncodeSupport {
  jpeg: boolean;
  webp: boolean;
  /** Native canvas AVIF encoding. When false, a WebAssembly AVIF encoder is used instead. */
  avifNative: boolean;
}

export interface VideoEncodeSupport {
  /** Hardware or software encoders exposed through WebCodecs. */
  webcodecs: Record<VideoCodecId, boolean>;
  /** Encoders compiled into the bundled FFmpeg.wasm core. */
  ffmpeg: Record<VideoCodecId, boolean>;
  audio: { aac: boolean; opus: boolean };
}

/**
 * Encoders CompressKit uses from the single-threaded @ffmpeg/core 0.12 build. Its libx265 and
 * libvpx-vp9 are not reliable in WebAssembly (hang / memory fault), so they are not used.
 */
export const FFMPEG_CODECS: Record<VideoCodecId, boolean> = {
  h264: true,
  h265: false,
  vp9: false,
  vp8: true,
  av1: false,
};

/** Codec the FFmpeg fallback uses for each container. */
export const FFMPEG_FALLBACK_CODEC = { mp4: 'h264', webm: 'vp8' } as const;

export const WEBCODECS_CODEC_STRINGS: Record<VideoCodecId, string> = {
  h264: 'avc1.640028',
  h265: 'hvc1.1.6.L120.B0',
  vp9: 'vp09.00.40.08',
  vp8: 'vp8',
  av1: 'av01.0.08M.08',
};

function canvasEncodes(mime: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(false);
      ctx.fillStyle = '#3a7';
      ctx.fillRect(0, 0, 2, 2);
      canvas.toBlob((blob) => resolve(!!blob && blob.type === mime), mime, 0.8);
    } catch {
      resolve(false);
    }
  });
}

export async function detectImageEncodeSupport(): Promise<ImageEncodeSupport> {
  const [jpeg, webp, avifNative] = await Promise.all([
    canvasEncodes('image/jpeg'),
    canvasEncodes('image/webp'),
    canvasEncodes('image/avif'),
  ]);
  return { jpeg, webp, avifNative };
}

async function videoConfigSupported(codec: string): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const res = await VideoEncoder.isConfigSupported({
      codec,
      width: 1920,
      height: 1080,
      bitrate: 4_000_000,
      framerate: 30,
    });
    return res.supported === true;
  } catch {
    return false;
  }
}

async function audioConfigSupported(codec: string): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false;
  try {
    const res = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate: 48_000,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    return res.supported === true;
  } catch {
    return false;
  }
}

export async function detectVideoEncodeSupport(): Promise<VideoEncodeSupport> {
  const ids = Object.keys(WEBCODECS_CODEC_STRINGS) as VideoCodecId[];
  const results = await Promise.all(ids.map((id) => videoConfigSupported(WEBCODECS_CODEC_STRINGS[id])));
  const webcodecs = Object.fromEntries(ids.map((id, i) => [id, results[i]])) as Record<VideoCodecId, boolean>;
  const [aac, opus] = await Promise.all([audioConfigSupported('mp4a.40.2'), audioConfigSupported('opus')]);
  return { webcodecs, ffmpeg: FFMPEG_CODECS, audio: { aac, opus } };
}
