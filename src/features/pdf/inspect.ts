import type { PdfSource } from '../../types/pdf';
import { getOpenPdf } from './documents';

/** One piece of hidden information found in a file, and whether saved PDFs still carry it. */
export interface Finding {
  label: string;
  value: string;
  /** 'removed': never copied into saved PDFs. 'optional': kept unless the matching option is on. */
  fate: 'removed' | 'optional';
}

function formatDate(d: Date | undefined): string | null {
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : null;
}

async function inspectPdf(source: PdfSource): Promise<Finding[]> {
  const lib = await import('@cantoo/pdf-lib');
  const { PDFName, PDFDict, PDFArray } = lib;
  const doc = getOpenPdf(source.id).edit;
  const out: Finding[] = [];
  const add = (label: string, value: string | null | undefined, fate: Finding['fate'] = 'removed') => {
    if (value && value.trim()) out.push({ label, value: value.trim(), fate });
  };
  add('Title', doc.getTitle());
  add('Author', doc.getAuthor());
  add('Subject', doc.getSubject());
  add('Keywords', doc.getKeywords());
  add('Created with', doc.getCreator());
  add('Made by software', doc.getProducer());
  add('Created', formatDate(doc.getCreationDate()));
  add('Last changed', formatDate(doc.getModificationDate()));
  if (doc.catalog.get(PDFName.of('Metadata'))) add('XMP metadata', 'Present (can hold names, edit history, and software details)');

  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (names?.get(PDFName.of('EmbeddedFiles'))) add('Attached files', 'Present');
  if (names?.get(PDFName.of('JavaScript')) || doc.catalog.get(PDFName.of('OpenAction'))) add('Scripts or actions', 'Present');

  let comments = 0;
  const kinds = new Set<string>();
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const subtype = annot?.get(PDFName.of('Subtype'))?.toString().slice(1);
      if (subtype && subtype !== 'Link' && subtype !== 'Widget' && subtype !== 'Popup') {
        comments++;
        kinds.add(subtype);
      }
    }
  }
  if (comments) add('Comments and markup', `${comments} (${[...kinds].join(', ')})`, 'optional');
  return out;
}

/** Reads camera, date and location from a JPEG's EXIF block. Other photo formats are not parsed. */
function readExif(buffer: ArrayBuffer): Finding[] {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return [];
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return parseTiff(view, offset + 10);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    offset += 2 + length;
  }
  return [];
}

function parseTiff(view: DataView, tiff: number): Finding[] {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(tiff + o, little);
  const u32 = (o: number) => view.getUint32(tiff + o, little);
  const ascii = (o: number, n: number) => {
    let s = '';
    for (let i = 0; i < n - 1 && tiff + o + i < view.byteLength; i++) s += String.fromCharCode(view.getUint8(tiff + o + i));
    return s.replace(/\0+$/, '').trim();
  };
  /** Reads one directory's entries: tag → [type, count, value offset]. */
  const dir = (at: number) => {
    const entries = new Map<number, [number, number, number]>();
    if (at <= 0 || tiff + at + 2 > view.byteLength) return entries;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (tiff + e + 12 > view.byteLength) break;
      entries.set(u16(e), [u16(e + 2), u32(e + 4), e + 8]);
    }
    return entries;
  };
  const text = (entries: Map<number, [number, number, number]>, tag: number) => {
    const e = entries.get(tag);
    if (!e || e[0] !== 2) return null;
    return ascii(e[1] > 4 ? u32(e[2]) : e[2], e[1]);
  };
  const rationals = (entries: Map<number, [number, number, number]>, tag: number) => {
    const e = entries.get(tag);
    if (!e || e[0] !== 5) return null;
    const at = u32(e[2]);
    return Array.from({ length: e[1] }, (_, i) => u32(at + i * 8) / (u32(at + i * 8 + 4) || 1));
  };

  const ifd0 = dir(u32(4));
  const exif = dir(ifd0.get(0x8769) ? u32(ifd0.get(0x8769)![2]) : 0);
  const gps = dir(ifd0.get(0x8825) ? u32(ifd0.get(0x8825)![2]) : 0);
  const out: Finding[] = [];
  const add = (label: string, value: string | null) => value && out.push({ label, value, fate: 'removed' });
  add('Camera', [text(ifd0, 0x010f), text(ifd0, 0x0110)].filter(Boolean).join(' ') || null);
  add('Taken', text(exif, 0x9003) ?? text(ifd0, 0x0132));
  add('Edited with', text(ifd0, 0x0131));
  add('Artist', text(ifd0, 0x013b));
  const lat = rationals(gps, 0x0002);
  const lon = rationals(gps, 0x0004);
  if (lat && lon) {
    const deg = ([d, m, s]: number[]) => d + (m ?? 0) / 60 + (s ?? 0) / 3600;
    const sign = (ref: string | null, neg: string) => (ref === neg ? -1 : 1);
    const la = deg(lat) * sign(text(gps, 0x0001), 'S');
    const lo = deg(lon) * sign(text(gps, 0x0003), 'W');
    add('Location (GPS)', `${la.toFixed(5)}, ${lo.toFixed(5)}`);
  }
  return out;
}

/** What hidden information a file carries, for the "Remove hidden info" view. */
export async function inspectSource(source: PdfSource): Promise<Finding[]> {
  if (source.kind === 'pdf') return inspectPdf(source);
  // Only the start of the file holds EXIF; 256 KB covers it even with a large embedded preview.
  return readExif(await source.file.slice(0, 256 * 1024).arrayBuffer());
}
