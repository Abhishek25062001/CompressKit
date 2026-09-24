import type { CleanOutput, HiddenInfo } from '../../types/clean';
import { formatCoordinates, orientationTiff, readIso6709, readTiff, readXmp } from './exif';
import { applyEdits, fourCC, readBytes, text, type Edit } from './patch';

/**
 * HEIC, AVIF, MP4, MOV and 3GP share one container format made of nested "boxes". Cleaning never
 * changes a box's size, so the offsets that point into the media data stay valid and nothing needs
 * rewriting: metadata boxes are renamed to "free" (padding every reader skips) and zeroed.
 */
interface Box {
  type: string;
  start: number;
  /** Where the payload begins. */
  body: number;
  end: number;
}

function parseBoxes(bytes: Uint8Array, from: number, to: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1 && at + 16 <= to) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) break;
    boxes.push({ type: fourCC(bytes, at + 4), start: at, body: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

async function topLevelBoxes(file: Blob): Promise<Box[]> {
  const boxes: Box[] = [];
  let at = 0;
  while (at + 8 <= file.size) {
    const head = await readBytes(file, at, Math.min(file.size, at + 16));
    const view = new DataView(head.buffer);
    let size = view.getUint32(0);
    let header = 8;
    if (size === 1 && head.length >= 16) {
      size = Number(view.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = file.size - at;
    }
    if (size < header || at + size > file.size) break;
    boxes.push({ type: fourCC(head, 4), start: at, body: at + header, end: at + size });
    at += size;
  }
  return boxes;
}

/** Turns a box into padding: renamed to "free" with its contents zeroed. Works on an in-memory copy. */
function blank(bytes: Uint8Array, box: Box): void {
  bytes.set([0x66, 0x72, 0x65, 0x65], box.start + 4);
  bytes.fill(0, box.body, box.end);
}

/** The children of a "meta" box, which is a full box in MP4/HEIF but a plain box in QuickTime. */
function metaChildren(bytes: Uint8Array, meta: Box): Box[] {
  const plain = meta.body + 8 <= meta.end && fourCC(bytes, meta.body + 4) === 'hdlr';
  return parseBoxes(bytes, plain ? meta.body : meta.body + 4, meta.end);
}

// ---------------------------------------------------------------------------------------------
// Photos: HEIC and AVIF keep EXIF and XMP as "items" whose bytes are listed in the iloc box.

const EMPTY_XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/>';
const XMP_END = '<?xpacket end="w"?>';

interface ItemData {
  kind: 'exif' | 'xmp';
  /** Absolute file ranges holding the item, in order. */
  extents: { start: number; end: number }[];
}

function readItems(meta: Uint8Array, metaStart: number): ItemData[] {
  const view = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  const root: Box = { type: 'meta', start: 0, body: 8, end: meta.length };
  const children = metaChildren(meta, root);
  const types = new Map<number, 'exif' | 'xmp'>();

  const iinf = children.find((b) => b.type === 'iinf');
  if (iinf) {
    const version = meta[iinf.body];
    const first = iinf.body + 4 + (version === 0 ? 2 : 4);
    for (const infe of parseBoxes(meta, first, iinf.end)) {
      if (infe.type !== 'infe') continue;
      const v = meta[infe.body];
      if (v < 2) continue;
      let at = infe.body + 4;
      const id = v === 2 ? view.getUint16(at) : view.getUint32(at);
      at += (v === 2 ? 2 : 4) + 2;
      const itemType = fourCC(meta, at);
      at += 4;
      at = meta.indexOf(0, at) + 1; // item name
      if (itemType === 'Exif') types.set(id, 'exif');
      else if (itemType === 'mime') {
        const contentType = text(meta, at, Math.max(at, meta.indexOf(0, at)));
        if (/xmp|rdf\+xml/i.test(contentType)) types.set(id, 'xmp');
      }
    }
  }

  const idat = children.find((b) => b.type === 'idat');
  const iloc = children.find((b) => b.type === 'iloc');
  if (!iloc || types.size === 0) return [];
  const version = meta[iloc.body];
  let at = iloc.body + 4;
  const sizes = view.getUint16(at);
  at += 2;
  const offsetSize = sizes >> 12;
  const lengthSize = (sizes >> 8) & 0xf;
  const baseSize = (sizes >> 4) & 0xf;
  const indexSize = version >= 1 ? sizes & 0xf : 0;
  const read = (n: number) => {
    const value = n === 8 ? Number(view.getBigUint64(at)) : n === 4 ? view.getUint32(at) : n === 2 ? view.getUint16(at) : 0;
    at += n;
    return value;
  };
  const count = version < 2 ? read(2) : read(4);
  const items: ItemData[] = [];
  for (let i = 0; i < count && at < iloc.end; i++) {
    const id = version < 2 ? read(2) : read(4);
    const method = version >= 1 ? read(2) & 0xf : 0;
    read(2); // data reference index
    const base = read(baseSize);
    const extentCount = read(2);
    const extents: ItemData['extents'] = [];
    for (let e = 0; e < extentCount; e++) {
      read(indexSize);
      const offset = read(offsetSize);
      const length = read(lengthSize);
      // Method 0: offsets into the file. Method 1: offsets into the idat box inside meta.
      const origin = method === 1 && idat ? metaStart + idat.body : 0;
      extents.push({ start: origin + base + offset, end: origin + base + offset + length });
    }
    const kind = types.get(id);
    if (kind && (method === 0 || method === 1) && extents.every((x) => x.end > x.start)) items.push({ kind, extents });
  }
  return items;
}

async function cleanHeif(file: Blob, boxes: Box[]): Promise<CleanOutput> {
  const found: HiddenInfo[] = [];
  const edits: Edit[] = [];
  const metaBox = boxes.find((b) => b.type === 'meta');
  if (!metaBox) return { blob: file, removed: found, notes: [] };
  const meta = await readBytes(file, metaBox.start, metaBox.end);

  for (const item of readItems(meta, metaBox.start)) {
    const parts = await Promise.all(item.extents.map((x) => readBytes(file, x.start, x.end)));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const data = new Uint8Array(total);
    parts.reduce((at, p) => (data.set(p, at), at + p.length), 0);

    // The replacement has the same length, so no offsets in the file change.
    const replacement = new Uint8Array(total);
    if (item.kind === 'exif') {
      const view = new DataView(data.buffer);
      const report = readTiff(view, 4 + (total >= 4 ? view.getUint32(0) : 0));
      found.push(...report.found);
      const tiff = orientationTiff(report.orientation);
      if (total >= 4 + tiff.length) replacement.set(tiff, 4);
    } else {
      found.push(...readXmp(text(data)));
      const packet = new TextEncoder().encode(EMPTY_XMP);
      const end = new TextEncoder().encode(XMP_END);
      replacement.fill(0x20);
      if (total >= packet.length + end.length) {
        replacement.set(packet);
        replacement.set(end, total - end.length);
      }
    }
    let at = 0;
    for (const x of item.extents) {
      edits.push({ start: x.start, end: x.end, data: replacement.slice(at, at + (x.end - x.start)) });
      at += x.end - x.start;
    }
  }
  return { blob: edits.length ? applyEdits(file, edits) : file, removed: found, notes: [] };
}

// ---------------------------------------------------------------------------------------------
// Videos: location, device and dates live in udta and meta boxes inside moov, plus the timestamps
// in the movie, track and media headers.

/** Seconds between 1904-01-01 (the QuickTime epoch) and 1970-01-01. */
const MAC_EPOCH = 2082844800;

const ATOM_LABEL: Record<string, Omit<HiddenInfo, 'value'>> = {
  '©xyz': { kind: 'location', label: 'Location (GPS)' },
  '©mak': { kind: 'device', label: 'Make' },
  '©mod': { kind: 'device', label: 'Model' },
  '©swr': { kind: 'software', label: 'Recorded with' },
  '©too': { kind: 'software', label: 'Encoded with' },
  '©day': { kind: 'date', label: 'Recorded' },
  '©ART': { kind: 'person', label: 'Artist' },
  '©aut': { kind: 'person', label: 'Author' },
  '©cmt': { kind: 'other', label: 'Comment' },
};

const KEY_LABEL: Record<string, Omit<HiddenInfo, 'value'>> = {
  'com.apple.quicktime.location.ISO6709': { kind: 'location', label: 'Location (GPS)' },
  'com.apple.quicktime.location.name': { kind: 'location', label: 'Place' },
  'com.apple.quicktime.make': { kind: 'device', label: 'Make' },
  'com.apple.quicktime.model': { kind: 'device', label: 'Model' },
  'com.apple.quicktime.software': { kind: 'software', label: 'Recorded with' },
  'com.apple.quicktime.creationdate': { kind: 'date', label: 'Recorded' },
  'com.apple.quicktime.author': { kind: 'person', label: 'Author' },
  'com.android.version': { kind: 'software', label: 'Android version' },
  'com.android.manufacturer': { kind: 'device', label: 'Make' },
  'com.android.model': { kind: 'device', label: 'Model' },
};

function labelled(label: Omit<HiddenInfo, 'value'>, raw: string): HiddenInfo | null {
  const value = raw.replace(/\0/g, '').trim();
  if (!value) return null;
  if (label.kind === 'location') {
    const coords = readIso6709(value);
    if (coords || label.label === 'Location (GPS)') return { ...label, value: coords ?? value };
  }
  return { ...label, value: value.slice(0, 120) };
}

/** A string atom, either QuickTime style (length, language, text) or iTunes style (a "data" box). */
function atomText(bytes: Uint8Array, box: Box): string {
  if (box.body + 16 <= box.end && fourCC(bytes, box.body + 4) === 'data') return text(bytes, box.body + 16, box.end);
  if (box.body + 4 > box.end) return '';
  const length = (bytes[box.body] << 8) | bytes[box.body + 1];
  return text(bytes, box.body + 4, Math.min(box.end, box.body + 4 + length));
}

/** 3GPP location box: version, language, place name, role, then 16.16 fixed-point longitude and latitude. */
function readLoci(bytes: Uint8Array, box: Box): HiddenInfo | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameStart = box.body + 6;
  const nameEnd = bytes.indexOf(0, nameStart);
  if (nameEnd < 0 || nameEnd + 10 > box.end) return null;
  const lon = view.getInt32(nameEnd + 2) / 65536;
  const lat = view.getInt32(nameEnd + 6) / 65536;
  const name = text(bytes, nameStart, nameEnd).trim();
  return { kind: 'location', label: 'Location (GPS)', value: `${formatCoordinates(lat, lon)}${name ? ` (${name})` : ''}` };
}

function readUserData(bytes: Uint8Array, udta: Box, found: HiddenInfo[]): void {
  for (const child of parseBoxes(bytes, udta.body, udta.end)) {
    if (child.type === 'meta') readMeta(bytes, child, found);
    if (child.type === 'loci') {
      const info = readLoci(bytes, child);
      if (info) found.push(info);
    }
    const label = ATOM_LABEL[child.type];
    const info = label && labelled(label, atomText(bytes, child));
    if (info) found.push(info);
  }
}

function readMeta(bytes: Uint8Array, meta: Box, found: HiddenInfo[]): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const children = metaChildren(bytes, meta);
  const keys: string[] = [];
  const keysBox = children.find((b) => b.type === 'keys');
  if (keysBox) {
    let at = keysBox.body + 8;
    const count = view.getUint32(keysBox.body + 4);
    for (let i = 0; i < count && at + 8 <= keysBox.end; i++) {
      const size = view.getUint32(at);
      if (size < 8) break;
      keys.push(text(bytes, at + 8, Math.min(keysBox.end, at + size)));
      at += size;
    }
  }
  const ilst = children.find((b) => b.type === 'ilst');
  if (!ilst) return;
  for (const item of parseBoxes(bytes, ilst.body, ilst.end)) {
    // In a "keys" list each item is named by its 1-based index; otherwise by a four-letter code.
    const index = view.getUint32(item.start + 4);
    const key = keysBox ? keys[index - 1] : item.type;
    const label = key ? (KEY_LABEL[key] ?? ATOM_LABEL[key]) : undefined;
    const data = parseBoxes(bytes, item.body, item.end).find((b) => b.type === 'data');
    const info = label && data && labelled(label, text(bytes, data.body + 8, data.end));
    if (info) found.push(info);
  }
}

/** Reads and clears the creation and modification times of an mvhd, tkhd or mdhd box. */
function clearTimes(bytes: Uint8Array, header: Box): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const v1 = bytes[header.body] === 1;
  const at = header.body + 4;
  if (at + (v1 ? 16 : 8) > header.end) return 0;
  const created = v1 ? Number(view.getBigUint64(at)) : view.getUint32(at);
  bytes.fill(0, at, at + (v1 ? 16 : 8));
  return created;
}

/** Joins "Make" and "Model" into one "Camera" line, as photos show it. */
function mergeDevice(found: HiddenInfo[]): HiddenInfo[] {
  const make = found.find((f) => f.label === 'Make')?.value;
  const model = found.find((f) => f.label === 'Model')?.value;
  if (!make && !model) return found;
  const camera = model?.startsWith(make ?? '\0') ? model : [make, model].filter(Boolean).join(' ');
  return [...found.filter((f) => f.label !== 'Make' && f.label !== 'Model'), { kind: 'device', label: 'Camera', value: camera! }];
}

async function cleanMovie(file: Blob, boxes: Box[]): Promise<CleanOutput> {
  let found: HiddenInfo[] = [];
  const edits: Edit[] = [];

  const moovBox = boxes.find((b) => b.type === 'moov');
  if (!moovBox) throw new Error('no moov box');
  const moov = await readBytes(file, moovBox.start, moovBox.end);
  let changed = false;
  let recorded = 0;

  const visit = (from: number, to: number, depth: number) => {
    for (const box of parseBoxes(moov, from, to)) {
      if (box.type === 'udta' || box.type === 'meta') {
        const before = found.length;
        if (box.type === 'udta') readUserData(moov, box, found);
        else readMeta(moov, box, found);
        if (found.length === before && box.end - box.body > 8) found.push({ kind: 'other', label: 'Maker data', value: 'Present' });
        blank(moov, box);
        changed = true;
      } else if (box.type === 'mvhd' || box.type === 'tkhd' || box.type === 'mdhd') {
        const created = clearTimes(moov, box);
        if (box.type === 'mvhd') recorded = created;
        changed ||= created !== 0;
      } else if ((box.type === 'trak' || box.type === 'mdia') && depth < 3) {
        visit(box.body, box.end, depth + 1);
      }
    }
  };
  visit(8, moov.length, 0);
  if (changed) edits.push({ start: moovBox.start, end: moovBox.end, data: moov });

  // XMP (in a "uuid" box) and stray metadata at the top level.
  const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';
  for (const box of boxes) {
    if (box.type !== 'uuid' && box.type !== 'udta' && box.type !== 'meta') continue;
    if (box.end - box.start > 16 * 1024 * 1024) continue;
    const bytes = await readBytes(file, box.start, box.end);
    const local: Box = { ...box, start: 0, body: box.body - box.start, end: box.end - box.start };
    if (box.type === 'uuid') {
      const uuid = Array.from(bytes.subarray(8, 24), (b) => b.toString(16).padStart(2, '0')).join('');
      if (uuid !== XMP_UUID) continue;
      found.push(...readXmp(text(bytes, 24)));
    } else if (box.type === 'udta') {
      readUserData(bytes, local, found);
    } else {
      readMeta(bytes, local, found);
    }
    blank(bytes, local);
    edits.push({ start: box.start, end: box.end, data: bytes });
  }

  found = mergeDevice(found);
  if (recorded > MAC_EPOCH && !found.some((f) => f.kind === 'date')) {
    found.push({ kind: 'date', label: 'Recorded', value: new Date((recorded - MAC_EPOCH) * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC' });
  }
  return { blob: edits.length ? applyEdits(file, edits) : file, removed: found, notes: [] };
}

export async function cleanIsoMedia(file: Blob): Promise<CleanOutput> {
  const boxes = await topLevelBoxes(file);
  const ftyp = boxes.find((b) => b.type === 'ftyp');
  const brand = ftyp ? fourCC(await readBytes(file, ftyp.body, ftyp.body + 4), 0) : '';
  const isImage = /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif|avis)$/.test(brand) && !boxes.some((b) => b.type === 'moov');
  return isImage ? cleanHeif(file, boxes) : cleanMovie(file, boxes);
}
