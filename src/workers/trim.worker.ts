import { CopyUnavailable, copyCut } from '../features/trim/copyCut';
import { splitRange } from '../features/trim/parts';
import { compressWithFFmpeg, type ProgressFn } from '../features/video/ffmpegEngine';
import { compressWithWebCodecs } from '../features/video/webcodecsEngine';
import type { VideoSettings } from '../types/settings';
import type { TimeRange, TrimJobRequest, TrimPartOutput, TrimWorkerResponse } from '../types/trim';
import { CompressionError, classifyError, describeError } from '../utils/errors';
import { workerScope } from '../types/worker-scope';

function post(message: TrimWorkerResponse): void {
  workerScope.postMessage(message);
}

/** Exact cuts are written as H.264 MP4 with AAC sound, which every phone and chat app plays. */
function preciseSettings(job: TrimJobRequest): VideoSettings {
  return {
    container: 'mp4',
    codec: 'h264',
    quality: 80,
    resolution: job.resolution,
    fps: 'original',
    audioBitrate: job.keepAudio ? 160 : 'remove',
    engine: 'auto',
  };
}

/** Room left in each re-encoded part for AAC padding, so a 60 s part stays under a 60 s limit. */
const ENCODED_PART_MARGIN = 0.1;

/** Re-encodes each part, with WebCodecs where the browser can, otherwise with FFmpeg.wasm. */
async function preciseCut(
  job: TrimJobRequest,
  onProgress: ProgressFn,
  notes: string[],
): Promise<{ parts: TrimPartOutput[]; engine: 'webcodecs' | 'ffmpeg' }> {
  const settings = preciseSettings(job);
  const ranges = splitRange(job.range, job.partSeconds, ENCODED_PART_MARGIN);
  const parts: TrimPartOutput[] = [];
  let useFFmpeg = false;

  for (let i = 0; i < ranges.length; i++) {
    const trim: TimeRange = ranges[i];
    const label = ranges.length > 1 ? `part ${i + 1} of ${ranges.length}` : 'video';
    const partProgress: ProgressFn = (p, stage) =>
      onProgress(p === null ? null : Math.min(0.99, (i + p) / ranges.length), `${stage} (${label})`);

    let blob: Blob | null = null;
    if (!useFFmpeg) {
      try {
        blob = (await compressWithWebCodecs({ file: job.file, settings, trim }, partProgress)).blob;
      } catch (error) {
        const code = error instanceof CompressionError ? error.code : null;
        if (code === 'CANCELLED' || code === 'OUT_OF_MEMORY') throw error;
        console.info('[CompressKit] WebCodecs trim unavailable, using FFmpeg:', describeError(error));
        useFFmpeg = true;
      }
    }
    if (!blob) {
      blob = (
        await compressWithFFmpeg({ file: job.file, settings, source: job.source, urls: job.ffmpeg, trim }, partProgress)
      ).blob;
    }
    parts.push({ blob, start: trim.start, end: trim.end });
  }

  if (useFFmpeg && ranges.length > 0) {
    notes.push('Your browser could not encode this video with hardware acceleration, so the FFmpeg engine was used.');
  }
  return { parts, engine: useFFmpeg ? 'ffmpeg' : 'webcodecs' };
}

async function run(job: TrimJobRequest): Promise<void> {
  let lastPost = 0;
  const onProgress: ProgressFn = (progress, stage) => {
    const now = performance.now();
    // Throttle to ~8 updates per second so React is not flooded.
    if (now - lastPost < 120 && progress !== 1) return;
    lastPost = now;
    post({ type: 'progress', jobId: job.jobId, progress, stage });
  };

  const notes: string[] = [];
  if (job.method === 'fast') {
    try {
      const out = await copyCut(job.file, job.range, job.partSeconds, job.keepAudio, onProgress);
      post({ type: 'done', jobId: job.jobId, parts: out.parts, mime: out.mime, engine: 'copy', notes: out.notes });
      return;
    } catch (error) {
      if (!(error instanceof CopyUnavailable)) throw error;
      console.info('[CompressKit] Lossless cut unavailable, re-encoding:', error.message);
      notes.push(error.userNote ?? 'This video could not be cut without re-encoding, so it was re-encoded to MP4 instead.');
    }
  }

  const out = await preciseCut(job, onProgress, notes);
  onProgress(1, 'Finalizing');
  post({ type: 'done', jobId: job.jobId, parts: out.parts, mime: 'video/mp4', engine: out.engine, notes });
}

// Cancellation is handled by the main thread terminating this worker.
workerScope.addEventListener('message', (event: MessageEvent<TrimJobRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'trim') return;
  void run(msg).catch((error: unknown) => {
    post({ type: 'error', jobId: msg.jobId, code: classifyError(error), detail: describeError(error) });
  });
});
