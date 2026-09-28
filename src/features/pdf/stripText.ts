/**
 * Makes a copy of a PDF with all its text removed and everything else (photos, drawings, colours,
 * backgrounds) left in place. PDF to PowerPoint renders that copy as each slide's background and
 * puts the text back on top as editable text boxes.
 *
 * Text in a PDF lives between BT and ET operators in content streams (a page's, or those of form
 * XObjects it draws). The streams are tokenized properly, so strings, dictionaries, comments and
 * inline images are stepped over and never mistaken for operators, and every BT…ET object is cut.
 */

type Lib = typeof import('@cantoo/pdf-lib');
type PDFDocument = import('@cantoo/pdf-lib').PDFDocument;
type PDFDict = import('@cantoo/pdf-lib').PDFDict;

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** Byte ranges [start, end) of every text object (BT … ET) in a content stream. */
export function textObjectRanges(data: Uint8Array): [number, number][] {
  const ranges: [number, number][] = [];
  const n = data.length;
  let i = 0;
  let textStart = -1;
  while (i < n) {
    const c = data[i];
    if (WS.has(c)) {
      i++;
      continue;
    }
    if (c === 0x25) {
      // Comment, to the end of the line.
      while (i < n && data[i] !== 0x0a && data[i] !== 0x0d) i++;
      continue;
    }
    if (c === 0x28) {
      // Literal string: balanced parentheses, backslash escapes.
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const d = data[i];
        if (d === 0x5c) i += 2;
        else {
          if (d === 0x28) depth++;
          else if (d === 0x29) depth--;
          i++;
        }
      }
      continue;
    }
    if (c === 0x3c) {
      if (data[i + 1] === 0x3c) {
        i += 2;
        continue;
      }
      // Hex string.
      i++;
      while (i < n && data[i] !== 0x3e) i++;
      i++;
      continue;
    }
    if (c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      i++;
      continue;
    }
    if (c === 0x2f) {
      // Name.
      i++;
      while (i < n && !WS.has(data[i]) && !DELIM.has(data[i])) i++;
      continue;
    }
    // A number or an operator: a run of regular characters.
    const start = i;
    while (i < n && !WS.has(data[i]) && !DELIM.has(data[i])) i++;
    const len = i - start;
    if (len === 2 && data[start] === 0x42 && data[start + 1] === 0x54) {
      // BT
      if (textStart < 0) textStart = start;
    } else if (len === 2 && data[start] === 0x45 && data[start + 1] === 0x54) {
      // ET
      if (textStart >= 0) {
        ranges.push([textStart, i]);
        textStart = -1;
      }
    } else if (len === 2 && data[start] === 0x49 && data[start + 1] === 0x44) {
      // ID: inline image data follows one whitespace byte and ends at "EI" between whitespace.
      i++;
      while (i < n) {
        if (
          data[i] === 0x45 &&
          data[i + 1] === 0x49 &&
          WS.has(data[i - 1]) &&
          (i + 2 >= n || WS.has(data[i + 2]) || DELIM.has(data[i + 2]))
        ) {
          i += 2;
          break;
        }
        i++;
      }
    }
  }
  // An unterminated text object runs to the end of the stream.
  if (textStart >= 0) ranges.push([textStart, n]);
  return ranges;
}

/** The stream without its text objects; each is replaced by a space so neighbouring tokens stay apart. */
export function removeTextObjects(data: Uint8Array): Uint8Array {
  const ranges = textObjectRanges(data);
  if (!ranges.length) return data;
  const kept = ranges.reduce((len, [s, e]) => len - (e - s) + 1, data.length);
  const out = new Uint8Array(kept);
  let pos = 0;
  let from = 0;
  for (const [s, e] of ranges) {
    out.set(data.subarray(from, s), pos);
    pos += s - from;
    out[pos++] = 0x20;
    from = e;
  }
  out.set(data.subarray(from), pos);
  return out;
}

/**
 * Removes text from every page of a PDF, and from the form XObjects the pages draw (at any depth).
 * Returns the new file's bytes; the original is not changed.
 */
export async function stripText(bytes: Uint8Array, password?: string): Promise<Uint8Array> {
  const lib: Lib = await import('@cantoo/pdf-lib');
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, decodePDFRawStream } = lib;
  // Loaded like openPdf does: a locked PDF is decrypted with its password, and saved unlocked.
  const doc: PDFDocument = await PDFDocument.load(bytes, { password, updateMetadata: false });
  const context = doc.context;
  const done = new Set<string>();

  const cleanStream = (ref: import('@cantoo/pdf-lib').PDFRef | undefined, stream: import('@cantoo/pdf-lib').PDFRawStream) => {
    const decoded = decodePDFRawStream(stream).decode();
    const stripped = removeTextObjects(decoded);
    if (stripped === decoded) return;
    const dict = stream.dict.clone(context);
    dict.delete(PDFName.of('Filter'));
    dict.delete(PDFName.of('DecodeParms'));
    const next = context.flateStream(stripped, Object.fromEntries([...dict.entries()].map(([k, v]) => [k.asString().slice(1), v])));
    if (ref) context.assign(ref, next);
    return next;
  };

  const cleanResources = (resources: PDFDict | undefined, depth: number) => {
    if (!resources || depth > 8) return;
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) return;
    for (const [, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef)) continue;
      const key = value.toString();
      if (done.has(key)) continue;
      done.add(key);
      const obj = context.lookup(value);
      if (!(obj instanceof PDFRawStream)) continue;
      if (obj.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') continue;
      // A form's own resources may name more forms; read them before the stream is replaced.
      const inner = obj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict);
      cleanStream(value, obj);
      cleanResources(inner, depth + 1);
    }
  };

  for (const page of doc.getPages()) {
    const node = page.node;
    const contents = node.get(PDFName.of('Contents'));
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    // Content split over several streams may cut a text object in two, so the streams are joined first.
    const parts: Uint8Array[] = [];
    for (const r of refs) {
      const s = r instanceof PDFRef ? context.lookup(r) : r;
      if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    }
    if (parts.length) {
      const joined = new Uint8Array(parts.reduce((len, p) => len + p.length + 1, 0));
      let pos = 0;
      for (const p of parts) {
        joined.set(p, pos);
        pos += p.length;
        joined[pos++] = 0x0a;
      }
      node.set(PDFName.of('Contents'), context.register(context.flateStream(removeTextObjects(joined))));
    }
    cleanResources(node.Resources(), 0);
  }
  return doc.save({ useObjectStreams: true });
}
