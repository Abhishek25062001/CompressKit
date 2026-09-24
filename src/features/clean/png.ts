import type { CleanOutput, HiddenInfo } from '../../types/clean';
import { orientationTiff, readTiff, readXmp } from './exif';
import { applyEdits, fourCC, latin1, readBytes, text, type Edit } from './patch';

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const TEXT_LABEL: Record<string, HiddenInfo> = {
  Author: { kind: 'person', label: 'Author', value: '' },
  Copyright: { kind: 'person', label: 'Copyright', value: '' },
  Comment: { kind: 'other', label: 'Comment', value: '' },
  Description: { kind: 'other', label: 'Description', value: '' },
  Software: { kind: 'software', label: 'Created with', value: '' },
  'Creation Time': { kind: 'date', label: 'Created', value: '' },
};

/**
 * Removes eXIf, text (tEXt, zTXt, iTXt, including XMP) and time chunks from a PNG. The image data and
 * colour chunks are copied as they are.
 */
export async function cleanPng(file: Blob): Promise<CleanOutput> {
  const found: HiddenInfo[] = [];
  const edits: Edit[] = [];
  let orientation = 1;
  let afterHeader = 8;

  let offset = 8;
  while (offset + 12 <= file.size) {
    const head = await readBytes(file, offset, offset + 8);
    const length = new DataView(head.buffer).getUint32(0);
    const type = fourCC(head, 4);
    const end = offset + 12 + length;
    if (type === 'IHDR') afterHeader = end;
    if (type === 'IDAT' || type === 'IEND') {
      offset = end;
      if (type === 'IEND') break;
      continue;
    }
    if (type === 'eXIf') {
      const data = await readBytes(file, offset + 8, offset + 8 + length);
      const report = readTiff(new DataView(data.buffer), 0);
      found.push(...report.found);
      orientation = report.orientation;
      edits.push({ start: offset, end, data: null });
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const data = await readBytes(file, offset + 8, offset + 8 + Math.min(length, 64 * 1024));
      const nul = data.indexOf(0);
      const keyword = latin1(data, 0, nul < 0 ? Math.min(79, data.length) : nul);
      if (keyword === 'XML:com.adobe.xmp' && type !== 'zTXt') {
        // iTXt: keyword\0 compression flag, method, language\0, translated keyword\0, text.
        let at = nul + 3;
        for (let skip = 0; skip < 2 && at < data.length; skip++) at = data.indexOf(0, at) + 1 || data.length;
        found.push(...readXmp(text(data, type === 'iTXt' ? at : nul + 1)));
      } else {
        const known = TEXT_LABEL[keyword];
        const value = type === 'tEXt' ? text(data, nul + 1).trim().slice(0, 120) : 'Present';
        found.push(known ? { ...known, value } : { kind: 'other', label: `Text: ${keyword || 'unnamed'}`, value });
      }
      edits.push({ start: offset, end, data: null });
    } else if (type === 'tIME') {
      found.push({ kind: 'date', label: 'Last changed', value: 'Present' });
      edits.push({ start: offset, end, data: null });
    }
    offset = end;
  }

  if (orientation !== 1) {
    edits.unshift({ start: afterHeader, end: afterHeader, data: chunk('eXIf', orientationTiff(orientation)) });
  }
  return { blob: edits.length ? applyEdits(file, edits) : file, removed: found, notes: [] };
}
