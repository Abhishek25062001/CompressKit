import type { CleanOutput, HiddenInfo } from '../../types/clean';
import { orientationTiff, readTiff, readXmp } from './exif';
import { applyEdits, fourCC, readBytes, text, type Edit } from './patch';

const FLAG_EXIF = 0x08;
const FLAG_XMP = 0x04;

function riffChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const padded = data.length + (data.length & 1);
  const out = new Uint8Array(8 + padded);
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

/**
 * Removes the EXIF and XMP chunks of a WebP, clears their flags in the extended header and fixes the
 * RIFF size. Image, alpha, animation and colour-profile chunks are copied as they are.
 */
export async function cleanWebp(file: Blob): Promise<CleanOutput> {
  const found: HiddenInfo[] = [];
  const edits: Edit[] = [];
  let orientation = 1;
  let vp8x: { at: number; flags: number } | null = null;

  let offset = 12;
  while (offset + 8 <= file.size) {
    const head = await readBytes(file, offset, offset + 8);
    const type = fourCC(head, 0);
    const size = new DataView(head.buffer).getUint32(4, true);
    const end = Math.min(file.size, offset + 8 + size + (size & 1));
    if (type === 'VP8X') {
      vp8x = { at: offset + 8, flags: (await readBytes(file, offset + 8, offset + 9))[0] };
    } else if (type === 'EXIF') {
      const data = await readBytes(file, offset + 8, offset + 8 + size);
      // Some writers keep JPEG's "Exif\0\0" prefix in front of the TIFF block.
      const tiff = data[0] === 0x45 && data[1] === 0x78 ? 6 : 0;
      const report = readTiff(new DataView(data.buffer), tiff);
      found.push(...report.found);
      orientation = report.orientation;
      edits.push({ start: offset, end, data: null });
    } else if (type === 'XMP ') {
      found.push(...readXmp(text(await readBytes(file, offset + 8, offset + 8 + size))));
      edits.push({ start: offset, end, data: null });
    }
    offset = end;
  }
  if (edits.length === 0) return { blob: file, removed: found, notes: [] };

  // EXIF belongs at the end of the file; only the orientation is written back.
  const keepOrientation = orientation !== 1 && vp8x !== null;
  if (keepOrientation) edits.push({ start: file.size, end: file.size, data: riffChunk('EXIF', orientationTiff(orientation)) });
  if (vp8x) {
    const flags = (vp8x.flags & ~(FLAG_EXIF | FLAG_XMP)) | (keepOrientation ? FLAG_EXIF : 0);
    edits.push({ start: vp8x.at, end: vp8x.at + 1, data: new Uint8Array([flags]) });
  }

  const removed = edits.reduce((n, e) => n + (e.end - e.start) - (e.data?.byteLength ?? 0), 0);
  const riffSize = new Uint8Array(4);
  new DataView(riffSize.buffer).setUint32(0, file.size - 8 - removed, true);
  edits.push({ start: 4, end: 8, data: riffSize });
  return { blob: applyEdits(file, edits), removed: found, notes: [] };
}
