import { toFriendlyError } from '../../constants/errors';
import {
  LARGE_IMAGE_BYTES,
  LARGE_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  detectFormat,
} from '../../constants/formats';
import { useQueueStore } from '../../store/queueStore';
import { useUiStore } from '../../store/uiStore';
import type { QueueItem } from '../../types/media';
import { formatBytes } from '../../utils/format';
import { createId } from '../../utils/id';
import { probeImage, probeVideo } from '../../utils/probe';

const PROBE_CONCURRENCY = 3;

async function probeAll(items: QueueItem[]): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++];
      const probe = item.kind === 'image' ? await probeImage(item.file) : await probeVideo(item.file);
      const current = useQueueStore.getState().items[item.id];
      if (!current) {
        // Removed while probing: release the thumbnail we just created.
        if (probe.thumbUrl) URL.revokeObjectURL(probe.thumbUrl);
        continue;
      }
      useQueueStore.getState().updateItem(item.id, { meta: probe.meta, thumbUrl: probe.thumbUrl });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, items.length) }, worker));
}

/** Validates dropped or selected files, adds supported ones to the queue and reads their metadata. */
export function addFiles(files: Iterable<File>): number {
  const accepted: QueueItem[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    const format = detectFormat(file);
    if (!format) {
      rejected.push(file.name);
      continue;
    }
    const kind = format.kind;
    const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    const large = kind === 'image' ? LARGE_IMAGE_BYTES : LARGE_VIDEO_BYTES;
    const tooLarge = file.size > max;
    const mime = file.type || format.mimes[0];

    accepted.push({
      id: createId(),
      // Normalize a missing MIME type (common for MKV/MOV on some systems) so engines can rely on it.
      file: file.type ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified }),
      kind,
      name: file.name,
      size: file.size,
      mime,
      typeLabel: format.label,
      thumbUrl: null,
      meta: { probed: false },
      status: tooLarge ? 'failed' : 'waiting',
      progress: null,
      stage: null,
      result: null,
      error: tooLarge ? toFriendlyError('FILE_TOO_LARGE') : null,
      override: null,
      warning:
        !tooLarge && file.size > large
          ? `Large file (${formatBytes(file.size)}). Processing may be slow and use a lot of memory.`
          : null,
    });
  }

  if (rejected.length) {
    useUiStore.getState().pushNotice({
      tone: 'warning',
      title: rejected.length === 1 ? '1 file was skipped' : `${rejected.length} files were skipped`,
      message: `Unsupported type: ${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? '…' : ''}`,
    });
  }
  if (accepted.length) {
    useQueueStore.getState().addItems(accepted);
    void probeAll(accepted.filter((i) => i.status !== 'failed'));
  }
  return accepted.length;
}
