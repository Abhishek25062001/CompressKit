/**
 * Writes a 24-bit Windows bitmap, the variant every program that opens BMP files reads. Browsers
 * decode BMP but cannot write it, so the bytes are laid out here. Transparent pixels should be
 * flattened onto a background first: 24-bit BMP has no alpha channel.
 */
export function encodeBmp(image: ImageData, dpi: number): Blob {
  const { width, height, data } = image;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowSize * height;
  const headerSize = 14 + 40;
  const buffer = new ArrayBuffer(headerSize + pixelBytes);
  const view = new DataView(buffer);
  const pixelsPerMeter = Math.round(dpi / 0.0254);

  // BITMAPFILEHEADER
  view.setUint8(0, 0x42); // B
  view.setUint8(1, 0x4d); // M
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, headerSize, true);
  // BITMAPINFOHEADER
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  // A positive height stores rows bottom-up, which old readers expect.
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(30, 0, true); // BI_RGB, uncompressed
  view.setUint32(34, pixelBytes, true);
  view.setInt32(38, pixelsPerMeter, true);
  view.setInt32(42, pixelsPerMeter, true);

  const out = new Uint8Array(buffer, headerSize);
  for (let y = 0; y < height; y++) {
    let src = (height - 1 - y) * width * 4;
    let dst = y * rowSize;
    for (let x = 0; x < width; x++, src += 4, dst += 3) {
      out[dst] = data[src + 2];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src];
    }
  }
  return new Blob([buffer], { type: 'image/bmp' });
}
