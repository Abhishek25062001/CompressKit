/**
 * Writes baseline TIFF files, one page or many, which browsers cannot produce themselves. Pixels are
 * LZW-compressed with the horizontal predictor: lossless, readable by every TIFF reader (Windows,
 * macOS Preview, Photoshop, fax and document-archive software), and many times smaller than raw
 * pixels for scanned text.
 */

export type TiffColor = 'rgb' | 'gray';

interface EncodedPage {
  width: number;
  height: number;
  samples: 1 | 3;
  rowsPerStrip: number;
  strips: Uint8Array[];
  dpi: number;
}

/** About this much raw pixel data per strip, so readers can decode part of a page at a time. */
const STRIP_BYTES = 64 * 1024;

const CLEAR = 256;
const EOI = 257;
const FIRST_CODE = 258;
/** libtiff resets the table before code 4094, and so must we for readers that mirror it. */
const TABLE_LIMIT = 4094;

/**
 * TIFF's LZW: codes are written most significant bit first, start at 9 bits, and widen one code
 * before the table outgrows them. Follows libtiff's encoder, the reference readers are tested with.
 */
class LzwEncoder {
  /** Code for (prefix code, next byte), or 0 when absent; indexed prefix * 256 + byte. */
  private table = new Uint16Array(4096 * 256);
  private used: number[] = [];
  private out: Uint8Array;
  private length = 0;
  private bitBuffer = 0;
  private bitCount = 0;

  constructor(capacity: number) {
    this.out = new Uint8Array(Math.max(1024, capacity));
  }

  private put(code: number, bits: number): void {
    this.bitBuffer = (this.bitBuffer << bits) | code;
    this.bitCount += bits;
    while (this.bitCount >= 8) {
      this.bitCount -= 8;
      if (this.length === this.out.length) {
        const bigger = new Uint8Array(this.out.length * 2);
        bigger.set(this.out);
        this.out = bigger;
      }
      this.out[this.length++] = (this.bitBuffer >>> this.bitCount) & 0xff;
    }
    // Keep only the bits not yet written, so the buffer never overflows 32 bits.
    this.bitBuffer &= (1 << this.bitCount) - 1;
  }

  private reset(): void {
    for (const i of this.used) this.table[i] = 0;
    this.used.length = 0;
  }

  encode(input: Uint8Array): Uint8Array {
    let bits = 9;
    let next = FIRST_CODE;
    this.put(CLEAR, bits);
    if (input.length === 0) {
      this.put(EOI, bits);
      return this.finish();
    }
    let prefix = input[0];
    for (let i = 1; i < input.length; i++) {
      const byte = input[i];
      const key = prefix * 256 + byte;
      const found = this.table[key];
      if (found) {
        prefix = found;
        continue;
      }
      this.put(prefix, bits);
      this.table[key] = next;
      this.used.push(key);
      next++;
      prefix = byte;
      if (next === TABLE_LIMIT) {
        this.put(CLEAR, bits);
        this.reset();
        bits = 9;
        next = FIRST_CODE;
      } else if (next > (1 << bits) - 1) {
        bits++;
      }
    }
    this.put(prefix, bits);
    next++;
    if (next === TABLE_LIMIT) {
      this.put(CLEAR, bits);
      bits = 9;
    } else if (next > (1 << bits) - 1) {
      bits++;
    }
    this.put(EOI, bits);
    this.reset();
    return this.finish();
  }

  private finish(): Uint8Array {
    if (this.bitCount > 0) this.put(0, 8 - this.bitCount);
    const result = this.out.slice(0, this.length);
    this.length = 0;
    this.bitBuffer = 0;
    this.bitCount = 0;
    return result;
  }
}

/** Collects pages, compressing each as it is added, then writes them as one TIFF file. */
export class TiffWriter {
  private pages: EncodedPage[] = [];
  private lzw = new LzwEncoder(STRIP_BYTES);
  private color: TiffColor;

  constructor(color: TiffColor = 'rgb') {
    this.color = color;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Adds a page. Alpha is dropped, so flatten transparency onto a background first. */
  addPage(image: ImageData, dpi: number): void {
    const { width, height, data } = image;
    const samples = this.color === 'gray' ? 1 : 3;
    const rowBytes = width * samples;
    const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(STRIP_BYTES / rowBytes)));
    const strips: Uint8Array[] = [];
    const raw = new Uint8Array(rowBytes * rowsPerStrip);
    for (let top = 0; top < height; top += rowsPerStrip) {
      const rows = Math.min(rowsPerStrip, height - top);
      for (let r = 0; r < rows; r++) {
        let src = (top + r) * width * 4;
        const rowStart = r * rowBytes;
        if (samples === 3) {
          for (let x = 0, dst = rowStart; x < width; x++, src += 4, dst += 3) {
            raw[dst] = data[src];
            raw[dst + 1] = data[src + 1];
            raw[dst + 2] = data[src + 2];
          }
        } else {
          for (let x = 0, dst = rowStart; x < width; x++, src += 4, dst++) {
            // Rec. 601 luma, the weighting scanners and printers use.
            raw[dst] = (data[src] * 299 + data[src + 1] * 587 + data[src + 2] * 114 + 500) / 1000;
          }
        }
        // Horizontal predictor: each sample becomes its difference from the one to its left.
        for (let i = rowStart + rowBytes - 1; i >= rowStart + samples; i--) raw[i] = (raw[i] - raw[i - samples]) & 0xff;
      }
      strips.push(this.lzw.encode(raw.subarray(0, rows * rowBytes)));
    }
    this.pages.push({ width, height, samples, rowsPerStrip, strips, dpi });
  }

  toBlob(): Blob {
    return new Blob([writeTiff(this.pages) as BlobPart], { type: 'image/tiff' });
  }
}

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const ASCII = 2;

interface Entry {
  tag: number;
  type: number;
  values: number[] | string;
}

function writeTiff(pages: EncodedPage[]): Uint8Array {
  const software = 'CompressKit';
  const multi = pages.length > 1;
  // Lay out each page's directory and the data it points to, then fill in offsets in one pass.
  const parts: { entries: Entry[]; page: EncodedPage }[] = pages.map((page, n) => {
    const entries: Entry[] = [];
    if (multi) entries.push({ tag: 254, type: LONG, values: [2] });
    entries.push(
      { tag: 256, type: LONG, values: [page.width] },
      { tag: 257, type: LONG, values: [page.height] },
      { tag: 258, type: SHORT, values: page.samples === 3 ? [8, 8, 8] : [8] },
      { tag: 259, type: SHORT, values: [5] },
      { tag: 262, type: SHORT, values: [page.samples === 3 ? 2 : 1] },
      { tag: 273, type: LONG, values: page.strips.map(() => 0) },
      { tag: 277, type: SHORT, values: [page.samples] },
      { tag: 278, type: LONG, values: [page.rowsPerStrip] },
      { tag: 279, type: LONG, values: page.strips.map((s) => s.length) },
      { tag: 282, type: RATIONAL, values: [Math.round(page.dpi * 100), 100] },
      { tag: 283, type: RATIONAL, values: [Math.round(page.dpi * 100), 100] },
      { tag: 284, type: SHORT, values: [1] },
      { tag: 296, type: SHORT, values: [2] },
    );
    if (multi) entries.push({ tag: 297, type: SHORT, values: [n, pages.length] });
    entries.push({ tag: 305, type: ASCII, values: software }, { tag: 317, type: SHORT, values: [2] });
    return { entries, page };
  });

  const valueBytes = (e: Entry) =>
    e.type === ASCII ? (e.values as string).length + 1 : (e.values as number[]).length * (e.type === SHORT ? 2 : 4);
  const countOf = (e: Entry) => (e.type === ASCII ? (e.values as string).length + 1 : e.type === RATIONAL ? (e.values as number[]).length / 2 : (e.values as number[]).length);

  // Sizes: header, then per page its directory, out-of-line values and strips.
  let offset = 8;
  const layout = parts.map(({ entries, page }) => {
    const ifd = offset;
    offset += 2 + entries.length * 12 + 4;
    const extra = new Map<number, number>();
    for (const e of entries) {
      const size = valueBytes(e);
      if (size > 4) {
        extra.set(e.tag, offset);
        offset += size + (size & 1);
      }
    }
    const stripOffsets = page.strips.map((s) => {
      const at = offset;
      offset += s.length + (s.length & 1);
      return at;
    });
    return { ifd, extra, stripOffsets };
  });

  const bytes = new Uint8Array(offset);
  const view = new DataView(bytes.buffer);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, layout[0]?.ifd ?? 0, true);

  const writeValues = (at: number, e: Entry) => {
    if (e.type === ASCII) {
      const s = e.values as string;
      for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) & 0x7f;
      bytes[at + s.length] = 0;
      return;
    }
    (e.values as number[]).forEach((v, i) => {
      if (e.type === SHORT) view.setUint16(at + i * 2, v, true);
      else view.setUint32(at + i * 4, v, true);
    });
  };

  parts.forEach(({ entries, page }, n) => {
    const { ifd, extra, stripOffsets } = layout[n];
    entries.find((e) => e.tag === 273)!.values = stripOffsets;
    view.setUint16(ifd, entries.length, true);
    entries.forEach((e, i) => {
      const at = ifd + 2 + i * 12;
      view.setUint16(at, e.tag, true);
      view.setUint16(at + 2, e.type, true);
      view.setUint32(at + 4, countOf(e), true);
      const out = extra.get(e.tag);
      if (out !== undefined) {
        view.setUint32(at + 8, out, true);
        writeValues(out, e);
      } else {
        writeValues(at + 8, e);
      }
    });
    view.setUint32(ifd + 2 + entries.length * 12, layout[n + 1]?.ifd ?? 0, true);
    page.strips.forEach((s, i) => bytes.set(s, stripOffsets[i]));
  });
  return bytes;
}
