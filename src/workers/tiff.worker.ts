import { inflateSync } from 'fflate';
import { workerScope } from '../types/worker-scope';

/**
 * Decodes every page of a TIFF file into PNGs, which the rest of the PDF tool handles like any
 * photo. Browsers other than Safari cannot read TIFF, and scanners and fax software write it with
 * compressions (CCITT fax, old-style JPEG, LZW) that only a dedicated decoder handles, so this uses
 * UTIF.js, the decoder behind Photopea. It runs in a worker because large scans take a while.
 */

export interface TiffRequest {
  buffer: ArrayBuffer;
  /** Pages with more pixels than this are skipped rather than exhausting memory. */
  maxPixels: number;
}

export interface TiffPage {
  blob: Blob;
  width: number;
  height: number;
}

export type TiffResponse = { ok: true; pages: TiffPage[]; tooLarge: number; failed: number } | { ok: false; error: string };

// UTIF looks for pako to inflate Deflate-compressed TIFFs; fflate, already in the app, does the same job.
(self as unknown as { pako: unknown }).pako = { inflateRaw: (data: Uint8Array) => inflateSync(data) };

type Ifd = Record<string, unknown> & { width: number; height: number; data: Uint8Array };

const first = (value: unknown): number | undefined => (Array.isArray(value) && typeof value[0] === 'number' ? value[0] : undefined);

/** UTIF gives RATIONAL tags as [numerator, denominator] pairs. */
function rational(value: unknown): number | undefined {
  const pair = Array.isArray(value) ? value[0] : undefined;
  if (Array.isArray(pair) && pair[1]) return pair[0] / pair[1];
  return typeof pair === 'number' ? pair : undefined;
}

workerScope.addEventListener('message', (event: MessageEvent<TiffRequest>) => {
  const { buffer, maxPixels } = event.data;
  void (async () => {
    try {
      const UTIF = (await import('utif2')).default as unknown as {
        decode: (buffer: ArrayBuffer) => Ifd[];
        decodeImage: (buffer: ArrayBuffer, ifd: Ifd, ifds: Ifd[]) => void;
        toRGBA8: (ifd: Ifd) => Uint8Array;
      };
      const ifds = UTIF.decode(buffer);
      // Bit 0 of NewSubfileType marks a reduced-size preview of another page, not a page of its own.
      const images = ifds.filter((ifd) => first(ifd.t256) && first(ifd.t257) && !((first(ifd.t254) ?? 0) & 1));
      const pages: TiffPage[] = [];
      let tooLarge = 0;
      let failed = 0;
      for (const ifd of images) {
        const width = first(ifd.t256)!;
        const height = first(ifd.t257)!;
        if (width * height > maxPixels) {
          tooLarge++;
          continue;
        }
        try {
          UTIF.decodeImage(buffer, ifd, ifds);
          const rgba = UTIF.toRGBA8(ifd);
          ifd.data = new Uint8Array(0);
          let canvas = new OffscreenCanvas(width, height);
          canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, width * height * 4), width, height), 0, 0);
          // Fax pages are often 204 × 98 DPI: pixels twice as tall as wide. Stretch to square pixels
          // so the page is not squashed.
          const xRes = rational(ifd.t282);
          const yRes = rational(ifd.t283);
          if (xRes && yRes && Math.abs(xRes - yRes) / Math.max(xRes, yRes) > 0.02) {
            const w = xRes < yRes ? Math.round((width * yRes) / xRes) : width;
            const h = yRes < xRes ? Math.round((height * xRes) / yRes) : height;
            if (w * h <= maxPixels) {
              const square = new OffscreenCanvas(w, h);
              const ctx = square.getContext('2d')!;
              ctx.imageSmoothingQuality = 'high';
              ctx.drawImage(canvas, 0, 0, w, h);
              canvas.width = 0;
              canvas = square;
            }
          }
          pages.push({ blob: await canvas.convertToBlob({ type: 'image/png' }), width: canvas.width, height: canvas.height });
          canvas.width = 0;
        } catch (e) {
          console.warn('[CompressKit] TIFF page could not be decoded:', e);
          failed++;
        }
      }
      workerScope.postMessage({ ok: true, pages, tooLarge, failed } satisfies TiffResponse);
    } catch (e) {
      workerScope.postMessage({ ok: false, error: String(e) } satisfies TiffResponse);
    }
  })();
});
