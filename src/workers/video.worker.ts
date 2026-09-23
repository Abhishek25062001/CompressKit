import { compressWithFFmpeg, type EngineOutput } from '../features/video/ffmpegEngine';
import { WebCodecsUnavailable, compressWithWebCodecs } from '../features/video/webcodecsEngine';
import { CODEC_LABEL } from '../features/video/videoParams';
import { FFMPEG_CODECS, FFMPEG_FALLBACK_CODEC } from '../utils/mediaCapabilities';
import type { VideoJobRequest, WorkerResponse } from '../types/worker';
import { CompressionError, classifyError, describeError } from '../utils/errors';
import { workerScope } from '../types/worker-scope';

function post(message: WorkerResponse): void {
  workerScope.postMessage(message);
}

async function run(job: VideoJobRequest): Promise<void> {
  const { settings } = job;
  let lastPost = 0;
  const onProgress = (progress: number | null, stage: string) => {
    const now = performance.now();
    // Throttle to ~8 updates per second so React is not flooded.
    if (now - lastPost < 120 && progress !== 1) return;
    lastPost = now;
    post({ type: 'progress', jobId: job.jobId, progress, stage });
  };

  const notes: string[] = [];
  let out: (EngineOutput & { width?: number; height?: number }) | null = null;
  let engine = 'ffmpeg';

  if (settings.engine !== 'ffmpeg') {
    try {
      out = await compressWithWebCodecs({ file: job.file, settings }, onProgress);
      engine = 'webcodecs';
    } catch (error) {
      const code = error instanceof CompressionError ? error.code : null;
      if (code === 'CANCELLED' || code === 'OUT_OF_MEMORY') throw error;
      if (settings.engine === 'webcodecs') {
        throw new CompressionError('CODEC_UNSUPPORTED', describeError(error));
      }
      console.info('[CompressKit] WebCodecs path unavailable, using FFmpeg:', describeError(error));
      if (!(error instanceof WebCodecsUnavailable)) {
        notes.push('Hardware encoding failed for this file, so the FFmpeg engine was used instead.');
      }
    }
  }

  if (!out) {
    let ffSettings = settings;
    if (!FFMPEG_CODECS[settings.codec]) {
      // Keep the requested container but switch to the codec the FFmpeg build encodes reliably.
      const fallback = FFMPEG_FALLBACK_CODEC[settings.container];
      ffSettings = { ...settings, codec: fallback };
      notes.push(
        `Your browser has no ${CODEC_LABEL[settings.codec]} encoder for this file, so ${CODEC_LABEL[fallback]} was used instead.`,
      );
    }
    out = await compressWithFFmpeg(
      { file: job.file, settings: ffSettings, source: job.source, urls: job.ffmpeg },
      onProgress,
    );
    engine = 'ffmpeg';
  }

  notes.push(...out.notes);
  const sameContainer = out.mime === job.file.type;
  if (out.blob.size >= job.file.size && sameContainer && settings.resolution === 'original') {
    post({
      type: 'done',
      jobId: job.jobId,
      blob: job.file,
      mime: job.file.type,
      notes: ['This video is already well compressed, so the original was kept unchanged.'],
      engine: 'original',
      keptOriginal: true,
    });
    return;
  }
  if (out.blob.size >= job.file.size) {
    notes.push('The new file is not smaller than the original. Try a lower quality or resolution.');
  }

  post({
    type: 'done',
    jobId: job.jobId,
    blob: out.blob,
    mime: out.mime,
    width: out.width,
    height: out.height,
    notes,
    engine,
    keptOriginal: false,
  });
}

// Cancellation is handled by the main thread terminating this worker, which also releases
// all WebAssembly memory, decoders and encoders immediately.
workerScope.addEventListener('message', (event: MessageEvent<VideoJobRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'compress') return;
  void run(msg).catch((error: unknown) => {
    post({ type: 'error', jobId: msg.jobId, code: classifyError(error), detail: describeError(error) });
  });
});
