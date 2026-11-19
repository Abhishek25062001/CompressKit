import { removeBackground } from '../features/background/cutout';
import { installMemoryProbes, memlog, setMemlogSink } from '../features/background/memlog';
import { GpuFailedError, releaseEngine } from '../features/background/model';
import type { BackgroundJobRequest, GpuFailedMessage } from '../types/background';
import type { WorkerResponse } from '../types/worker';
import { classifyError, describeError } from '../utils/errors';
import { workerScope } from '../types/worker-scope';

/** After this long without a photo the session is released (GPU buffers, tensors). The page terminates the worker at 45 s, which frees the WebAssembly heap too. */
const IDLE_RELEASE_MS = 30_000;

// Dev only: report WebAssembly heap and GPU buffer sizes. Must run before ONNX Runtime loads.
installMemoryProbes();

let currentJob = '';
setMemlogSink((sample) => workerScope.postMessage({ type: 'memlog', jobId: currentJob, sample }));

function post(message: WorkerResponse | GpuFailedMessage): void {
  workerScope.postMessage(message);
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function run(job: BackgroundJobRequest): Promise<void> {
  let lastPost = 0;
  const onProgress = (progress: number | null, stage: string) => {
    const now = performance.now();
    if (now - lastPost < 120 && progress !== 1) return;
    lastPost = now;
    post({ type: 'progress', jobId: job.jobId, progress, stage });
  };
  try {
    const out = await removeBackground(job, onProgress);
    // Blobs are passed by reference, not copied.
    post({
      type: 'done',
      jobId: job.jobId,
      blob: out.blob,
      mime: out.mime,
      width: out.width,
      height: out.height,
      notes: out.notes,
      engine: out.device,
      keptOriginal: false,
      debug: out.debug,
    });
  } catch (error) {
    if (!(error instanceof GpuFailedError)) throw error;
    // Nothing more runs in this worker: the page terminates it (freeing whatever the graphics card
    // attempt allocated) and retries on the processor in a fresh one.
    post({ type: 'gpu-failed', jobId: job.jobId, detail: error.message });
    return;
  }
  memlog('after cleanup', {}, 'per-photo buffers dropped (freed at the next garbage collection); session kept');
}

// The session stays loaded between photos and is released when idle. Cancelling terminates the worker, which frees it at once.
workerScope.addEventListener('message', (event: MessageEvent<BackgroundJobRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'remove-background') return;
  if (idleTimer) clearTimeout(idleTimer);
  currentJob = msg.jobId;
  void run(msg)
    .catch((error: unknown) => {
      post({ type: 'error', jobId: msg.jobId, code: classifyError(error), detail: describeError(error) });
    })
    .finally(() => {
      idleTimer = setTimeout(() => {
        void releaseEngine().then((released) => {
          if (released) memlog('session released (idle 30 s)', {}, 'session.release() called');
        });
      }, IDLE_RELEASE_MS);
    });
});
