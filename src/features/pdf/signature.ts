import type { SignatureAsset } from '../../types/pdf';
import { canvasToBlob, createCanvas, getContext, releaseCanvas, type AnyCanvas } from '../image/canvas';
import { decodeImage } from '../image/decode';

/** Largest side of a stored signature: sharp when printed at signature size, small in the PDF. */
const MAX_SIDE = 1200;
const PAD = 6;

/** Crops away fully transparent borders. Returns null when nothing was drawn. */
function trim(source: AnyCanvas): AnyCanvas | null {
  const { width, height } = source;
  const data = getContext(source).getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) return null;
  left = Math.max(0, left - PAD);
  top = Math.max(0, top - PAD);
  const w = Math.min(width, right + PAD + 1) - left;
  const h = Math.min(height, bottom + PAD + 1) - top;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const out = createCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  getContext(out).drawImage(source, left, top, w, h, 0, 0, out.width, out.height);
  return out;
}

async function toAsset(canvas: AnyCanvas): Promise<SignatureAsset | null> {
  const trimmed = trim(canvas);
  if (!trimmed) return null;
  const blob = await canvasToBlob(trimmed, 'image/png');
  const asset = { blob, url: URL.createObjectURL(blob), width: trimmed.width, height: trimmed.height };
  releaseCanvas(trimmed);
  return asset;
}

/** A signature drawn on the pad. */
export function signatureFromDrawing(canvas: HTMLCanvasElement): Promise<SignatureAsset | null> {
  return toAsset(canvas);
}

export const SIGNATURE_FONTS = [
  { value: 'script', label: 'Handwritten', css: '"Segoe Script", "Brush Script MT", "Snell Roundhand", "URW Chancery L", cursive' },
  { value: 'italic', label: 'Classic italic', css: 'Georgia, "Times New Roman", serif' },
  { value: 'plain', label: 'Plain', css: 'Inter, "Helvetica Neue", Arial, sans-serif' },
] as const;

export type SignatureFont = (typeof SIGNATURE_FONTS)[number]['value'];

/** A typed name rendered in a handwriting-style font. */
export function signatureFromText(text: string, font: SignatureFont, color: string): Promise<SignatureAsset | null> {
  const css = SIGNATURE_FONTS.find((f) => f.value === font)?.css ?? SIGNATURE_FONTS[0].css;
  const size = 140;
  const style = `${font === 'italic' ? 'italic ' : ''}${font === 'plain' ? 500 : 400} ${size}px ${css}`;
  const measure = getContext(createCanvas(1, 1));
  measure.font = style;
  const canvas = createCanvas(Math.ceil(measure.measureText(text).width) + size, Math.ceil(size * 1.8));
  const ctx = getContext(canvas);
  ctx.font = style;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, canvas.height / 2);
  return toAsset(canvas);
}

/**
 * A photo or scan of a signature. With `removeBackground`, light paper turns transparent and ink
 * keeps its color, with a soft edge so strokes are not jagged.
 */
export async function signatureFromImage(file: File, removeBackground: boolean): Promise<SignatureAsset | null> {
  const bitmap = await decodeImage(file);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  const ctx = getContext(canvas);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  if (removeBackground) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    // Paper is rarely pure white in photos; treat anything brighter than the page's own light level as background.
    let brightest = 0;
    for (let i = 0; i < d.length; i += 4) brightest = Math.max(brightest, 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    const paper = Math.max(120, brightest - 60);
    const ink = paper - 70;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const alpha = lum >= paper ? 0 : lum <= ink ? 1 : (paper - lum) / (paper - ink);
      d[i + 3] = Math.round(d[i + 3] * alpha);
    }
    ctx.putImageData(image, 0, 0);
  }
  try {
    return await toAsset(canvas);
  } finally {
    releaseCanvas(canvas);
  }
}
