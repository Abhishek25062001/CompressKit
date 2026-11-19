import { removeWatermark } from '../features/watermark/removeWatermark';
import type { WatermarkJobRequest } from '../types/watermark';
import type { WorkerResponse } from '../types/worker';
import { classifyError, describeError } from '../utils/errors';
import { workerScope } from '../types/worker-scope';

function post(message: WorkerResponse): void {
  workerScope.postMessage(message);
}

async function run(job: WatermarkJobRequest): Promise<void> {
  let lastPost = 0;
  const onProgress = (progress: number | null, stage: string) => {
    const now = performance.now();
    if (now - lastPost < 120 && progress !== 1) return;
    lastPost = now;
    post({ type: 'progress', jobId: job.jobId, progress, stage });
  };
  const out = await removeWatermark(job, onProgress);
  post({
    type: 'done',
    jobId: job.jobId,
    blob: out.blob,
    mime: out.mime,
    width: out.width,
    height: out.height,
    notes: out.notes,
    engine: out.engine,
    keptOriginal: false,
  });
}

workerScope.addEventListener('message', (event: MessageEvent<WatermarkJobRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'remove-watermark') return;
  void run(msg).catch((error: unknown) => {
    post({ type: 'error', jobId: msg.jobId, code: classifyError(error), detail: describeError(error) });
  });
});
