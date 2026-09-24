import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type ConversionAudioOptions,
  type VideoCodec,
} from 'mediabunny';
import type { VideoCodecId, VideoSettings } from '../../types/settings';
import type { TimeRange } from '../../types/trim';
import { CompressionError } from '../../utils/errors';
import type { EngineOutput, ProgressFn } from './ffmpegEngine';
import {
  audioBitsPerSecond,
  computeVideoSize,
  estimateSourceVideoBitrate,
  outputMime,
  targetVideoBitrate,
} from './videoParams';

/** Thrown when WebCodecs cannot handle a file, so the caller may fall back to FFmpeg. */
export class WebCodecsUnavailable extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'WebCodecsUnavailable';
  }
}

const CODEC_MAP: Record<VideoCodecId, VideoCodec> = {
  h264: 'avc',
  h265: 'hevc',
  vp9: 'vp9',
  vp8: 'vp8',
  av1: 'av1',
};

export interface WebCodecsJob {
  file: File;
  settings: VideoSettings;
  /** Only encode this part of the source (trim tool). */
  trim?: TimeRange;
}

export function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

/**
 * Hardware-accelerated path: demux with Mediabunny, decode and encode with WebCodecs, mux to MP4/WebM.
 * The source is read lazily through BlobSource, so large files are never loaded into memory at once.
 */
export async function compressWithWebCodecs(
  job: WebCodecsJob,
  onProgress: ProgressFn,
): Promise<EngineOutput & { width: number; height: number }> {
  if (!webCodecsAvailable()) throw new WebCodecsUnavailable('WebCodecs API missing');
  const { settings } = job;
  const notes: string[] = [];
  onProgress(null, 'Analyzing video');

  const input = new Input({ source: new BlobSource(job.file), formats: ALL_FORMATS });
  try {
    let videoTrack;
    try {
      videoTrack = await input.getPrimaryVideoTrack();
    } catch (e) {
      throw new WebCodecsUnavailable(`demux failed: ${String(e)}`);
    }
    if (!videoTrack) throw new WebCodecsUnavailable('no video track found by demuxer');
    if (!(await videoTrack.canDecode())) throw new WebCodecsUnavailable(`cannot decode ${videoTrack.codec}`);

    const source = { width: videoTrack.displayWidth, height: videoTrack.displayHeight };
    const size = computeVideoSize(source, settings.resolution);
    const duration = await input.computeDuration();
    const stats = await videoTrack.computePacketStats(120);
    const sourceFps = stats.averagePacketRate > 0 ? stats.averagePacketRate : 30;
    const frameRate =
      settings.fps !== 'original' && sourceFps > settings.fps + 0.5 ? settings.fps : undefined;

    const bitrate = targetVideoBitrate({
      codec: settings.codec,
      quality: settings.quality,
      output: size,
      source,
      fps: frameRate ?? sourceFps,
      sourceBitrate: estimateSourceVideoBitrate(job.file.size, duration),
    });

    const codec = CODEC_MAP[settings.codec];
    const encodable = await canEncodeVideo(codec, {
      width: size.width,
      height: size.height,
      quality: new Quality({ bitrate }),
    });
    if (!encodable) throw new WebCodecsUnavailable(`no WebCodecs encoder for ${codec} at ${size.width}x${size.height}`);

    const audioTrack = await input.getPrimaryAudioTrack();
    const audioBps = audioBitsPerSecond(settings);
    let audio: ConversionAudioOptions = { discard: true };
    if (audioTrack && audioBps !== null) {
      const audioCodec: AudioCodec = settings.container === 'mp4' ? 'aac' : 'opus';
      const canTranscode =
        (await audioTrack.canDecode()) &&
        (await canEncodeAudio(audioCodec, {
          numberOfChannels: audioTrack.numberOfChannels,
          sampleRate: audioTrack.sampleRate,
          quality: new Quality({ bitrate: audioBps }),
        }));
      if (canTranscode) {
        audio = { codec: audioCodec, quality: new Quality({ bitrate: audioBps }), forceTranscode: true };
      } else if (audioTrack.codec === audioCodec) {
        audio = { codec: audioCodec };
        notes.push('Audio was copied without re-encoding because your browser has no encoder for it.');
      } else {
        throw new WebCodecsUnavailable(`cannot encode ${audioCodec} audio`);
      }
    }

    const mime = outputMime(settings);
    const target = new BufferTarget();
    const output = new Output({
      format: settings.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target,
    });

    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: {
        codec,
        width: size.width,
        height: size.height,
        fit: 'fill',
        frameRate,
        quality: new Quality({ bitrate, bitrateMode: 'variable' }),
        forceTranscode: true,
      },
      audio,
      trim: job.trim,
      tags: {},
      showWarnings: false,
    });

    if (!conversion.isValid || conversion.discardedTracks.some((d) => d.track.isVideoTrack())) {
      const reasons = conversion.discardedTracks.map((d) => d.reason).join(', ');
      throw new WebCodecsUnavailable(`conversion invalid: ${reasons}`);
    }

    conversion.onProgress = (p) => onProgress(Math.min(0.99, p), 'Encoding with WebCodecs');
    onProgress(0, 'Encoding with WebCodecs');
    try {
      await conversion.execute();
    } catch (e) {
      if (e instanceof ConversionCanceledError) throw new CompressionError('CANCELLED');
      // Encoder or decoder errors mid-stream: let the caller fall back to FFmpeg.
      throw new WebCodecsUnavailable(`conversion failed: ${String(e)}`);
    }

    const buffer = target.buffer;
    if (!buffer) throw new Error('muxer produced no output');
    onProgress(1, 'Finalizing');
    return { blob: new Blob([buffer], { type: mime }), mime, notes, width: size.width, height: size.height };
  } finally {
    input.dispose();
  }
}
