import { CompressionError } from '../../utils/errors';

const HEIF_MIMES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'];

/** HEIC files often arrive without a MIME type, so check the ISO-BMFF "ftyp" brand as well. */
async function isHeif(file: Blob): Promise<boolean> {
  if (HEIF_MIMES.includes(file.type)) return true;
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const text = String.fromCharCode(...head);
  return text.slice(4, 8) === 'ftyp' && HEIF_BRANDS.includes(text.slice(8, 12));
}

/**
 * Decodes HEIC/HEIF with libheif compiled to WebAssembly (about 2 MB, loaded only for these files).
 * libheif applies the rotation and mirroring stored in the file.
 */
async function decodeHeif(file: Blob): Promise<ImageBitmap> {
  const { default: createLibheif } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
  const libheif = createLibheif();
  const decoder = new libheif.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
  const primary = images.find((i) => i.is_primary()) ?? images[0];
  if (!primary) throw new CompressionError('DECODE_FAILED', 'libheif found no image');
  try {
    const width = primary.get_width();
    const height = primary.get_height();
    const pixels = await new Promise<ImageData>((resolve, reject) => {
      primary.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (out) =>
        out ? resolve(new ImageData(out.data, width, height)) : reject(new Error('libheif display failed')),
      );
    });
    return await createImageBitmap(pixels);
  } finally {
    images.forEach((i) => i.free());
  }
}

/** Decodes any supported image to a bitmap, honoring EXIF orientation. */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    // Safari decodes HEIC natively; other browsers throw here and fall back to libheif.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    if (await isHeif(file)) {
      try {
        return await decodeHeif(file);
      } catch (heifError) {
        if (heifError instanceof CompressionError) throw heifError;
        throw new CompressionError('DECODE_FAILED', `libheif failed: ${String(heifError)}`);
      }
    }
    throw new CompressionError('DECODE_FAILED', `createImageBitmap failed: ${String(e)}`);
  }
}
