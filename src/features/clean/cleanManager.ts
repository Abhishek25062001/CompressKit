import { MIME_EXTENSION, getExtension } from '../../constants/formats';
import type { QueueStore } from '../../store/queueStore';
import type { CleanOutput } from '../../types/clean';
import type { QueueItem } from '../../types/media';
import { sanitizeBaseName } from '../../utils/filename';
import { QueueRunner, type ProcessOutput } from '../compression/queueRunner';
import { cleanFile } from './cleanFile';

/** Cleaning only reads a few kilobytes per file, so several can run at once on the main thread. */
const PARALLEL = 3;

/**
 * Runs the clean tool's queue. Files are read as soon as they are added, so each card can say what
 * it hides; pressing Clean then only has to hand over the copy that was already prepared.
 */
export class CleanManager extends QueueRunner {
  private prepared = new Map<string, Promise<CleanOutput>>();

  constructor(queue: QueueStore) {
    super(queue, PARALLEL);
  }

  private prepare(item: QueueItem): Promise<CleanOutput> {
    let job = this.prepared.get(item.id);
    if (!job) {
      job = cleanFile(item.file);
      // A failure is reported when the file is processed, not while scanning.
      job.catch(() => undefined);
      this.prepared.set(item.id, job);
    }
    return job;
  }

  /** Reads newly added files and records what they hide. */
  scan(): void {
    const { order, items } = this.queue.getState();
    for (const id of order) {
      const item = items[id];
      if (!item || item.hidden !== undefined || item.status === 'failed' || this.prepared.has(id)) continue;
      void this.prepare(item).then(
        (out) => this.queue.getState().updateItem(id, { hidden: out.removed }),
        () => this.queue.getState().updateItem(id, { hidden: [] }),
      );
    }
  }

  protected override forget(id: string | null): void {
    if (id === null) this.prepared.clear();
    else this.prepared.delete(id);
  }

  protected override async process(item: QueueItem): Promise<ProcessOutput> {
    const out = await this.prepare(item);
    const ext = getExtension(item.name) || MIME_EXTENSION[item.mime] || 'bin';
    const notes = [...out.notes];
    if (out.removed.length === 0) notes.push('No hidden information was found, so the file is unchanged.');
    else notes.push('Nothing was re-encoded: the picture and sound are exactly the same as before.');
    return {
      result: {
        blob: out.blob,
        // Keep the original name, so the clean copy can be shared as if it were the original.
        fileName: `${sanitizeBaseName(item.name)}.${ext}`,
        mime: item.mime,
        formatLabel: item.typeLabel,
        size: out.blob.size,
        width: item.meta.width,
        height: item.meta.height,
        duration: item.meta.duration,
        engine: 'metadata',
        notes,
        keptOriginal: out.blob === item.file,
        removed: out.removed,
      },
      patch: { hidden: out.removed },
    };
  }
}
