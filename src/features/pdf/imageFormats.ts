import type { FormatDef } from '../../constants/formats';
import type { TiffResponse } from '../../workers/tiff.worker';

/**
 * Picture formats the PDF tool takes beyond everyday photos. A GIF becomes one page (its first frame,
 * which is what the browser decodes); a TIFF becomes one page per page in the file.
 */
export const GIF_FORMAT: FormatDef = { kind: 'image', label: 'GIF', mimes: ['image/gif'], extensions: ['gif'] };
export const TIFF_FORMAT: FormatDef = { kind: 'image', label: 'TIFF', mimes: ['image/tiff', 'image/tif', 'image/x-tiff'], extensions: ['tif', 'tiff'] };

/** Matches the render limit, so every decoded page can also be drawn. */
const MAX_TIFF_PIXELS = 100_000_000;

export function isTiff(file: File): boolean {
  return TIFF_FORMAT.mimes.includes(file.type) || /\.tiff?$/i.test(file.name);
}

/** Decodes a TIFF's pages to PNGs in a worker made for this file. */
export async function decodeTiff(file: File): Promise<TiffResponse> {
  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL('../../workers/tiff.worker.ts', import.meta.url), { type: 'module', name: 'compresskit-tiff' });
  try {
    return await new Promise<TiffResponse>((resolve) => {
      worker.onmessage = (e: MessageEvent<TiffResponse>) => resolve(e.data);
      worker.onerror = (e) => resolve({ ok: false, error: e.message || 'worker failed' });
      worker.postMessage({ buffer, maxPixels: MAX_TIFF_PIXELS }, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}

/**
 * Whether a GIF has more than one frame. Walks the file's blocks (extensions and images, each made
 * of length-prefixed sub-blocks) without decoding any pixels.
 */
export async function isAnimatedGif(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.arrayBuffer());
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return false;
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
  const skipSubBlocks = () => {
    while (i < b.length && b[i] !== 0) i += b[i] + 1;
    i++;
  };
  let frames = 0;
  while (i < b.length) {
    const block = b[i++];
    if (block === 0x21) {
      i++;
      skipSubBlocks();
    } else if (block === 0x2c) {
      if (++frames > 1) return true;
      const packed = b[i + 8];
      i += 9;
      if (packed & 0x80) i += 3 * (1 << ((packed & 7) + 1));
      i++;
      skipSubBlocks();
    } else {
      break;
    }
  }
  return false;
}
