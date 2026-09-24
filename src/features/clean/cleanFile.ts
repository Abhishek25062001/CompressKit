import type { CleanOutput, HiddenInfo } from '../../types/clean';
import { CompressionError } from '../../utils/errors';
import { cleanIsoMedia } from './isobmff';
import { cleanJpeg } from './jpeg';
import { fourCC, readBytes } from './patch';
import { cleanPng } from './png';
import { cleanWebp } from './webp';

/** The same detail can be stored twice (EXIF and XMP, for example); list it once. */
function unique(found: HiddenInfo[]): HiddenInfo[] {
  const seen = new Set<string>();
  return found.filter((f) => {
    const key = `${f.label}\n${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Returns a copy of the photo or video without location, device, date and other hidden details.
 * The picture and sound are never re-encoded: only metadata blocks are dropped or blanked, and the
 * orientation and colour profile are kept so the file looks exactly the same.
 */
export async function cleanFile(file: File): Promise<CleanOutput> {
  const head = await readBytes(file, 0, 12);
  let out: CleanOutput;
  try {
    if (head[0] === 0xff && head[1] === 0xd8) out = await cleanJpeg(file);
    else if (head[0] === 0x89 && fourCC(head, 1).startsWith('PNG')) out = await cleanPng(file);
    else if (fourCC(head, 0) === 'RIFF' && fourCC(head, 8) === 'WEBP') out = await cleanWebp(file);
    else if (fourCC(head, 4) === 'ftyp') out = await cleanIsoMedia(file);
    else throw new CompressionError('UNSUPPORTED_TYPE', `unrecognized signature ${Array.from(head).join(',')}`);
  } catch (error) {
    if (error instanceof CompressionError) throw error;
    throw new CompressionError('DECODE_FAILED', String(error));
  }
  const blob = out.blob === file ? file : new Blob([out.blob], { type: file.type });
  return { ...out, blob, removed: unique(out.removed) };
}
