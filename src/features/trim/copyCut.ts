import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  EncodedPacketSink,
  Input,
  MATROSKA,
  MkvOutputFormat,
  Mp4OutputFormat,
  Output,
  WEBM,
  WebMOutputFormat,
  type OutputFormat,
} from 'mediabunny';
import type { TimeRange, TrimPartOutput } from '../../types/trim';
import { CompressionError } from '../../utils/errors';
import type { ProgressFn } from '../video/ffmpegEngine';
import { MIN_PART_SECONDS, splitRange } from './parts';

/** Thrown when the video cannot be cut without re-encoding, so the caller re-encodes instead. */
export class CopyUnavailable extends Error {
  constructor(
    reason: string,
    /** Shown to the user when it explains something they can act on. */
    readonly userNote?: string,
  ) {
    super(reason);
    this.name = 'CopyUnavailable';
  }
}

export interface CopyCutResult {
  parts: TrimPartOutput[];
  mime: string;
  notes: string[];
}

const EPSILON = 0.001;

/**
 * Plans cuts that land on key frames, so each part can be copied without re-encoding.
 * Every part is at most `partSeconds` long (when splitting). The first cut moves back to the key
 * frame at or before the requested start. Returns null when key frames are too far apart to keep
 * parts under the limit.
 */
async function planCuts(sink: EncodedPacketSink, range: TimeRange, partSeconds: number | null): Promise<TimeRange[] | null> {
  const meta = { metadataOnly: true };
  const startKey = (await sink.getKeyPacket(range.start + EPSILON, meta)) ?? (await sink.getFirstKeyPacket(meta));
  if (!startKey) return null;
  let start = startKey.timestamp;

  if (partSeconds === null) return [{ start, end: range.end }];

  const parts: TimeRange[] = [];
  while (range.end - start > partSeconds + EPSILON) {
    const key = await sink.getKeyPacket(start + partSeconds + EPSILON, meta);
    // No key frame far enough in: a lossless cut would make this part too long.
    if (!key || key.timestamp <= start + EPSILON) return null;
    parts.push({ start, end: key.timestamp });
    start = key.timestamp;
  }
  if (range.end - start >= MIN_PART_SECONDS || parts.length === 0) parts.push({ start, end: range.end });
  return parts;
}

/** Keeps the source's container family, so every codec it holds can be copied as is. */
function outputFormatFor(formatName: string): { make: () => OutputFormat; mime: string } {
  if (formatName === WEBM.name) return { make: () => new WebMOutputFormat(), mime: 'video/webm' };
  if (formatName === MATROSKA.name) return { make: () => new MkvOutputFormat(), mime: 'video/x-matroska' };
  return { make: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), mime: 'video/mp4' };
}

/**
 * Cuts the video by copying its encoded packets. Nothing is decoded or encoded, so it is fast and
 * lossless, and it works for any codec the container can hold, even ones the browser cannot play.
 */
export async function copyCut(
  file: File,
  range: TimeRange,
  partSeconds: number | null,
  keepAudio: boolean,
  onProgress: ProgressFn,
): Promise<CopyCutResult> {
  onProgress(null, 'Finding key frames');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    let format;
    let videoTrack;
    try {
      format = await input.getFormat();
      videoTrack = await input.getPrimaryVideoTrack();
    } catch (e) {
      throw new CopyUnavailable(`demux failed: ${String(e)}`);
    }
    if (!videoTrack) throw new CopyUnavailable('no video track found by demuxer');

    const target = outputFormatFor(format.name);
    const videoCodec = videoTrack.codec;
    if (!videoCodec || !target.make().getSupportedVideoCodecs().includes(videoCodec)) {
      throw new CopyUnavailable(`cannot copy ${videoCodec ?? 'unknown'} video into ${target.mime}`);
    }

    const cuts = await planCuts(new EncodedPacketSink(videoTrack), range, partSeconds);
    if (!cuts) {
      throw new CopyUnavailable(
        'key frames too far apart for the part length',
        `This video has too few key frames to keep every part under ${partSeconds} s without re-encoding, so it was re-encoded for exact cuts.`,
      );
    }

    const notes: string[] = [];
    const parts: TrimPartOutput[] = [];
    let audioDropped = false;

    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i];
      const stage = cuts.length > 1 ? `Cutting part ${i + 1} of ${cuts.length}` : 'Cutting video';
      const buffer = new BufferTarget();
      const output = new Output({ format: target.make(), target: buffer });
      const conversion = await Conversion.init({
        input,
        output,
        tracks: 'primary',
        video: {},
        audio: keepAudio ? {} : { discard: true },
        trim: { start: cut.start, end: cut.end },
        // Copy only: if a track would need re-encoding it is left out, and missing video means we re-encode instead.
        // Cuts are on key frames already; 'shrink' drops the audio frame that straddles each cut, so a
        // 60 s part is not 60.02 s long and rejected by an app with a hard limit.
        copy: { mode: 'forced', shiftTolerance: Infinity, boundaryPolicy: 'shrink' },
        tags: {},
        showWarnings: false,
      });
      const discarded = conversion.discardedTracks;
      if (!conversion.isValid || discarded.some((d) => d.track.isVideoTrack())) {
        throw new CopyUnavailable(`copy invalid: ${discarded.map((d) => d.reason).join(', ')}`);
      }
      if (keepAudio && discarded.some((d) => d.track.isAudioTrack())) audioDropped = true;

      conversion.onProgress = (p) => onProgress(Math.min(0.99, (i + p) / cuts.length), stage);
      onProgress(i / cuts.length, stage);
      try {
        await conversion.execute();
      } catch (e) {
        if (e instanceof ConversionCanceledError) throw new CompressionError('CANCELLED');
        throw new CopyUnavailable(`copy failed: ${String(e)}`);
      }
      if (!buffer.buffer) throw new Error('muxer produced no output');
      parts.push({ blob: new Blob([buffer.buffer], { type: target.mime }), start: cut.start, end: cut.end });
    }

    const planned = splitRange(range, partSeconds).length;
    if (cuts.length > planned) {
      notes.push(
        `Key frames in this video are far apart, so it was cut into ${cuts.length} parts instead of ${planned}. Choose "Exact" for parts of exactly ${partSeconds} s.`,
      );
    }
    if (audioDropped) notes.push('The sound track could not be copied into this format, so the result is silent.');
    if (cuts[0].start < range.start - 0.05) {
      notes.push(
        `Fast cuts start on a key frame, so the video begins ${(range.start - cuts[0].start).toFixed(1)} s earlier than the start you picked. Choose "Exact" for frame-accurate cuts.`,
      );
    }
    onProgress(1, 'Finalizing');
    return { parts, mime: target.mime, notes };
  } finally {
    input.dispose();
  }
}
