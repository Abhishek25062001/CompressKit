import { Zip, ZipPassThrough } from 'fflate';
import { uniqueName } from './filename';

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/**
 * Builds a ZIP archive entirely in the browser. Media files are already compressed, so entries are
 * stored without deflate. Blobs are streamed chunk by chunk to avoid holding extra full copies.
 */
export async function createZip(
  entries: ZipEntry[],
  onProgress?: (ratio: number) => void,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];
  const total = entries.reduce((sum, e) => sum + e.blob.size, 0) || 1;
  let processed = 0;

  const done = new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, data, final) => {
      if (err) {
        reject(err);
        return;
      }
      chunks.push(data);
      if (final) resolve();
    });

    void (async () => {
      try {
        const taken = new Set<string>();
        for (const entry of entries) {
          const file = new ZipPassThrough(uniqueName(entry.name, taken));
          zip.add(file);
          const reader = entry.blob.stream().getReader();
          for (;;) {
            const { done: finished, value } = await reader.read();
            if (finished) break;
            file.push(value);
            processed += value.byteLength;
            onProgress?.(processed / total);
          }
          file.push(new Uint8Array(0), true);
        }
        zip.end();
      } catch (e) {
        reject(e);
      }
    })();
  });

  await done;
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}
