/** Canvas helpers that work with OffscreenCanvas (workers) and HTMLCanvasElement (main-thread fallback). */
export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type AnyContext2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function getContext(canvas: AnyCanvas): AnyContext2D {
  const ctx = canvas.getContext('2d', { alpha: true }) as AnyContext2D | null;
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

export function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))), type, quality);
  });
}

/** Frees the backing store of a canvas as early as possible. */
export function releaseCanvas(canvas: AnyCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}
