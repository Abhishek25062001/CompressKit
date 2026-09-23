import { toFriendlyError } from '../../constants/errors';
import {
  LARGE_IMAGE_BYTES,
  LARGE_VIDEO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  detectFormat,
  type FormatDef,
} from '../../constants/formats';
import type { QueueStore } from '../../store/queueStore';
import { useUiStore } from '../../store/uiStore';
import type { QueueItem } from '../../types/media';
import { formatBytes } from '../../utils/format';
import { createId } from '../../utils/id';
import { probeImage, probeVideo } from '../../utils/probe';

const PROBE_CONCURRENCY = 3;

async function probeAll(queue: QueueStore, items: { item: QueueItem; probeAs: QueueItem['kind'] }[]): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const { item, probeAs } = items[index++];
      const probe = probeAs === 'image' ? await probeImage(item.file) : await probeVideo(item.file);
      const current = queue.getState().items[item.id];
      if (!current) {
        // Removed while probing: release the thumbnail we just created.
        if (probe.thumbUrl) URL.revokeObjectURL(probe.thumbUrl);
        continue;
      }
      queue.getState().updateItem(item.id, { meta: probe.meta, thumbUrl: probe.thumbUrl });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, items.length) }, worker));
}

/** Validates dropped or selected files, adds supported ones to the queue and reads their metadata. */
export function addFilesTo(queue: QueueStore, formats: FormatDef[], files: Iterable<File>): number {
  const accepted: QueueItem[] = [];
  const probeKind = new Map<string, QueueItem['kind']>();
  const rejected: string[] = [];

  for (const file of files) {
    const format = detectFormat(file, formats);
    if (!format) {
      rejected.push(file.name);
      continue;
    }
    const kind = format.kind;
    const max = kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
    const large = kind === 'image' ? LARGE_IMAGE_BYTES : LARGE_VIDEO_BYTES;
    const tooLarge = file.size > max;
    const mime = file.type || format.mimes[0];
    const id = createId();
    probeKind.set(id, format.probeAs ?? kind);

    accepted.push({
      id,
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
      crop: null,
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
    queue.getState().addItems(accepted);
    void probeAll(
      queue,
      accepted.filter((i) => i.status !== 'failed').map((item) => ({ item, probeAs: probeKind.get(item.id) ?? item.kind })),
    );
  }
  return accepted.length;
}
