import type { CleanOutput, HiddenInfo } from '../../types/clean';
import { orientationTiff, readTiff, readXmp } from './exif';
import { applyEdits, latin1, readBytes, text, type Edit } from './patch';

const EXIF_ID = 'Exif\0\0';
const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';
const ICC_ID = 'ICC_PROFILE\0';

/** An APP1 segment holding only the orientation, so the photo still shows the right way up. */
function orientationSegment(orientation: number): Uint8Array<ArrayBuffer> {
  const tiff = orientationTiff(orientation);
  const payload = 6 + tiff.length;
  const out = new Uint8Array(4 + payload);
  out.set([0xff, 0xe1, (payload + 2) >> 8, (payload + 2) & 0xff]);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  out.set(tiff, 10);
  return out;
}

/** Offset just past the end-of-image marker of the main picture, scanning the compressed data in chunks. */
async function findImageEnd(file: Blob, from: number): Promise<number | null> {
  const CHUNK = 4 * 1024 * 1024;
  let prevFF = false;
  for (let at = from; at < file.size; at += CHUNK) {
    const bytes = await readBytes(file, at, Math.min(file.size, at + CHUNK));
    for (let i = 0; i < bytes.length; i++) {
      if (prevFF && bytes[i] === 0xd9) return at + i + 1;
      prevFF = bytes[i] === 0xff;
    }
  }
  return null;
}

/**
 * Removes EXIF (including GPS), XMP, IPTC, comments and vendor segments from a JPEG without touching
 * the compressed image, then writes back only the orientation. Colour profiles are kept.
 */
export async function cleanJpeg(file: Blob): Promise<CleanOutput> {
  const found: HiddenInfo[] = [];
  const notes: string[] = [];
  const edits: Edit[] = [];
  let orientation = 1;
  let insertAt = 2;

  let offset = 2;
  let scanStart: number | null = null;
  while (offset + 4 <= file.size) {
    const head = await readBytes(file, offset, offset + 4);
    if (head[0] !== 0xff) break;
    const marker = head[1];
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const end = offset + 2 + ((head[2] << 8) | head[3]);
    if (marker === 0xda) {
      scanStart = end;
      break;
    }

    let remove = false;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe0) {
      // JFIF header: harmless and expected first, so the new orientation block goes after it.
      if (offset === 2) insertAt = end;
    } else if (marker === 0xe1) {
      remove = true;
      const data = await readBytes(file, offset + 4, end);
      const id = latin1(data, 0, 29);
      if (id.startsWith(EXIF_ID)) {
        const report = readTiff(new DataView(data.buffer), 6);
        found.push(...report.found);
        orientation = report.orientation;
      } else if (id.startsWith(XMP_ID)) {
        found.push(...readXmp(text(data, XMP_ID.length)));
      }
    } else if (marker === 0xe2) {
      const id = latin1(await readBytes(file, offset + 4, Math.min(end, offset + 16)));
      remove = !id.startsWith(ICC_ID);
    } else if (marker === 0xed) {
      remove = true;
      found.push({ kind: 'other', label: 'IPTC / Photoshop info', value: 'Captions, names or places' });
    } else if (marker === 0xfe) {
      remove = true;
      const comment = text(await readBytes(file, offset + 4, Math.min(end, offset + 4 + 200))).replace(/\0/g, '').trim();
      if (comment) found.push({ kind: 'other', label: 'Comment', value: comment.slice(0, 120) });
    } else if (isApp && marker !== 0xee) {
      // Vendor blocks (APP3–APP12, APP15). APP14 "Adobe" describes the colour transform and stays.
      remove = true;
    }
    if (remove) edits.push({ start: offset, end, data: null });
    offset = end;
  }

  if (scanStart === null) throw new Error('JPEG has no image data');
  const imageEnd = await findImageEnd(file, scanStart);
  if (imageEnd !== null && file.size - imageEnd > 16) {
    edits.push({ start: imageEnd, end: file.size, data: null });
    found.push({ kind: 'other', label: 'Extra data after the photo', value: 'Motion photo, HDR layer or maker data' });
    notes.push('Data stored after the photo (such as a motion-photo clip or an HDR layer) was removed; the picture itself is unchanged.');
  }
  if (orientation !== 1 && edits.length > 0) edits.unshift({ start: insertAt, end: insertAt, data: orientationSegment(orientation) });

  return { blob: edits.length ? applyEdits(file, edits) : file, removed: found, notes };
}
