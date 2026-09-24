import { removeBackground } from '../features/background/cutout';
import { loadModel } from '../features/background/model';
import type { BackgroundJobRequest } from '../types/background';
import type { WorkerResponse } from '../types/worker';
import { classifyError, describeError } from '../utils/errors';
import { workerScope } from '../types/worker-scope';

function post(message: WorkerResponse): void {
  workerScope.postMessage(message);
}

async function run(job: BackgroundJobRequest): Promise<void> {
  let lastPost = 0;
  const onProgress = (progress: number | null, stage: string) => {
    const now = performance.now();
    if (now - lastPost < 120 && progress !== 1) return;
    lastPost = now;
    post({ type: 'progress', jobId: job.jobId, progress, stage });
  };
  const model = await loadModel(job, onProgress);
  const out = await removeBackground(job.file, job.settings, model, onProgress);
  post({
    type: 'done',
    jobId: job.jobId,
    blob: out.blob,
    mime: out.mime,
    width: out.width,
    height: out.height,
    notes: out.notes,
    engine: model.device,
    keptOriginal: false,
  });
}

// The model stays loaded between photos. Cancelling terminates the worker, which frees it at once.
workerScope.addEventListener('message', (event: MessageEvent<BackgroundJobRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'remove-background') return;
  void run(msg).catch((error: unknown) => {
    post({ type: 'error', jobId: msg.jobId, code: classifyError(error), detail: describeError(error) });
  });
});
