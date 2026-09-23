import type { QueueStore } from '../../store/queueStore';
import { downloadBlob } from '../../utils/download';
import { createZip } from '../../utils/zip';

export function downloadItem(queue: QueueStore, id: string): void {
  const item = queue.getState().items[id];
  if (item?.result) downloadBlob(item.result.blob, item.result.fileName);
}

/** Downloads every completed file: directly when there is one, otherwise as a ZIP built in the browser. */
export async function downloadAll(queue: QueueStore, zipPrefix: string, onProgress?: (ratio: number) => void): Promise<void> {
  const { order, items } = queue.getState();
  const results = order
    .map((id) => items[id])
    .filter((i) => i?.status === 'completed' && i.result)
    .map((i) => i.result!);
  if (results.length === 0) return;
  if (results.length === 1) {
    downloadBlob(results[0].blob, results[0].fileName);
    return;
  }
  const zip = await createZip(
    results.map((r) => ({ name: r.fileName, blob: r.blob })),
    onProgress,
  );
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(zip, `${zipPrefix}-${stamp}.zip`);
}
