import type { HiddenInfo } from '../../types/clean';

export interface TiffReport {
  found: HiddenInfo[];
  /** EXIF orientation (1–8). Kept when cleaning, because it decides which way up the photo is shown. */
  orientation: number;
}

type Entry = [type: number, count: number, valueAt: number];

export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Reads the details a camera writes into an EXIF (TIFF) block: device, dates, owner, software and
 * GPS position. `tiff` is the offset of the "II"/"MM" byte-order mark in `view`.
 */
export function readTiff(view: DataView, tiff: number): TiffReport {
  const found: HiddenInfo[] = [];
  let orientation = 1;
  if (tiff + 8 > view.byteLength) return { found, orientation };
  const mark = view.getUint16(tiff);
  if (mark !== 0x4949 && mark !== 0x4d4d) return { found, orientation };
  const little = mark === 0x4949;
  const inRange = (o: number, n: number) => o >= 0 && tiff + o + n <= view.byteLength;
  const u16 = (o: number) => (inRange(o, 2) ? view.getUint16(tiff + o, little) : 0);
  const u32 = (o: number) => (inRange(o, 4) ? view.getUint32(tiff + o, little) : 0);

  const dir = (at: number) => {
    const entries = new Map<number, Entry>();
    if (at <= 0 || !inRange(at, 2)) return entries;
    const n = Math.min(u16(at), 512);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (!inRange(e, 12)) break;
      entries.set(u16(e), [u16(e + 2), u32(e + 4), e + 8]);
    }
    return entries;
  };
  const text = (entries: Map<number, Entry>, tag: number) => {
    const e = entries.get(tag);
    if (!e || e[0] !== 2 || e[1] === 0) return null;
    const at = e[1] > 4 ? u32(e[2]) : e[2];
    let s = '';
    for (let i = 0; i < Math.min(e[1], 256) && inRange(at + i, 1); i++) {
      const c = view.getUint8(tiff + at + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim() || null;
  };
  const rationals = (entries: Map<number, Entry>, tag: number) => {
    const e = entries.get(tag);
    if (!e || e[0] !== 5 || e[1] < 1) return null;
    const at = u32(e[2]);
    return Array.from({ length: Math.min(e[1], 3) }, (_, i) => u32(at + i * 8) / (u32(at + i * 8 + 4) || 1));
  };
  const add = (kind: HiddenInfo['kind'], label: string, value: string | null) => {
    if (value) found.push({ kind, label, value });
  };

  const ifd0 = dir(u32(4));
  const pointer = (tag: number) => {
    const e = ifd0.get(tag);
    return e ? u32(e[2]) : 0;
  };
  const exif = dir(pointer(0x8769));
  const gps = dir(pointer(0x8825));

  const orient = ifd0.get(0x0112);
  if (orient && orient[0] === 3) orientation = u16(orient[2]) || 1;

  const lat = rationals(gps, 0x0002);
  const lon = rationals(gps, 0x0004);
  if (lat && lon) {
    const deg = ([d, m = 0, s = 0]: number[]) => d + m / 60 + s / 3600;
    const la = deg(lat) * (text(gps, 0x0001) === 'S' ? -1 : 1);
    const lo = deg(lon) * (text(gps, 0x0003) === 'W' ? -1 : 1);
    add('location', 'Location (GPS)', formatCoordinates(la, lo));
  } else if (gps.size > 0) {
    add('location', 'GPS data', 'Present');
  }
  add('device', 'Camera', [text(ifd0, 0x010f), text(ifd0, 0x0110)].filter(Boolean).join(' ') || null);
  add('device', 'Lens', text(exif, 0xa434));
  add('device', 'Serial number', text(exif, 0xa431));
  add('date', 'Taken', text(exif, 0x9003) ?? text(ifd0, 0x0132));
  add('person', 'Owner', text(exif, 0xa430));
  add('person', 'Artist', text(ifd0, 0x013b));
  add('person', 'Copyright', text(ifd0, 0x8298));
  add('other', 'Description', text(ifd0, 0x010e));
  add('software', 'Edited with', text(ifd0, 0x0131));
  add('software', 'Computer', text(ifd0, 0x013c));
  if (found.length === 0 && ifd0.size > 0) add('other', 'EXIF data', 'Present');
  return { found, orientation };
}

/**
 * A minimal big-endian TIFF block that only says which way up the photo is. Written back after
 * cleaning so a sideways phone photo is not suddenly shown rotated.
 */
export function orientationTiff(orientation: number): Uint8Array {
  const out = new Uint8Array(26);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0x4d4d); // "MM"
  view.setUint16(2, 42);
  view.setUint32(4, 8); // IFD0 right after the header
  view.setUint16(8, 1); // one entry
  view.setUint16(10, 0x0112); // Orientation
  view.setUint16(12, 3); // SHORT
  view.setUint32(14, 1);
  view.setUint16(18, orientation);
  view.setUint32(22, 0); // no next IFD
  return out;
}

/** Details found in an XMP packet (the XML metadata written by phones and photo editors). */
export function readXmp(xml: string): HiddenInfo[] {
  const found: HiddenInfo[] = [];
  // Values appear either as attributes (ns:Name="…") or as elements (<ns:Name>…</ns:Name>).
  const value = (name: string) => {
    const attr = new RegExp(`${name}="([^"]*)"`).exec(xml);
    if (attr) return attr[1].trim() || null;
    const el = new RegExp(`<${name}>\\s*(?:<rdf:(?:Seq|Bag|Alt)>\\s*<rdf:li[^>]*>)?([^<]*)<`).exec(xml);
    return el ? el[1].trim() || null : null;
  };
  const add = (kind: HiddenInfo['kind'], label: string, v: string | null) => {
    if (v) found.push({ kind, label, value: v });
  };
  const lat = value('exif:GPSLatitude');
  const lon = value('exif:GPSLongitude');
  if (lat && lon) add('location', 'Location (XMP)', `${lat}, ${lon}`);
  const place = ['photoshop:City', 'photoshop:State', 'photoshop:Country', 'Iptc4xmpCore:Location'].map(value).filter(Boolean);
  if (place.length) add('location', 'Place', place.join(', '));
  add('device', 'Camera', [value('tiff:Make'), value('tiff:Model')].filter(Boolean).join(' ') || null);
  add('date', 'Created', value('xmp:CreateDate') ?? value('photoshop:DateCreated') ?? value('exif:DateTimeOriginal'));
  add('person', 'Creator', value('dc:creator'));
  add('software', 'Created with', value('xmp:CreatorTool'));
  if (found.length === 0) add('other', 'XMP metadata', 'Present');
  return found;
}

/** Location written as ISO 6709, e.g. "+37.3349-122.0090+010.000/" in phone videos. */
export function readIso6709(text: string): string | null {
  const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(text);
  return m ? formatCoordinates(Number(m[1]), Number(m[2])) : null;
}
