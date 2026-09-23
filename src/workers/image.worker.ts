import { encodeImage } from '../features/image/encodeImage';
import type { ImageJobRequest, WorkerResponse } from '../types/worker';
import { classifyError, describeError } from '../utils/errors';
import { workerScope } from '../types/worker-scope';

function post(message: WorkerResponse): void {
  workerScope.postMessage(message);
}

workerScope.addEventListener('message', (event: MessageEvent<ImageJobRequest>) => {
  const job = event.data;
  if (job?.type !== 'compress') return;

  void (async () => {
    try {
      const out = await encodeImage({
        file: job.file,
        settings: job.settings,
        support: job.support,
        onStage: (stage) => post({ type: 'progress', jobId: job.jobId, progress: null, stage }),
      });
      post({
        type: 'done',
        jobId: job.jobId,
        blob: out.blob,
        mime: out.mime,
        width: out.width,
        height: out.height,
        notes: out.notes,
        engine: out.engine,
        keptOriginal: out.keptOriginal,
      });
    } catch (error) {
      post({ type: 'error', jobId: job.jobId, code: classifyError(error), detail: describeError(error) });
    }
  })();
});
