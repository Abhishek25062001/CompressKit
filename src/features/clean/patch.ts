/** A byte range of the source file to replace (or drop, with empty data). */
export interface Edit {
  start: number;
  end: number;
  data: Uint8Array<ArrayBuffer> | null;
}

/**
 * Builds the cleaned file from slices of the original plus the few bytes that changed. Blob slices
 * are not copied, so even a multi-gigabyte video costs almost no memory.
 */
export function applyEdits(file: Blob, edits: Edit[], type = file.type): Blob {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  const parts: BlobPart[] = [];
  let at = 0;
  for (const edit of sorted) {
    if (edit.start < at) throw new Error('overlapping edits');
    if (edit.start > at) parts.push(file.slice(at, edit.start));
    if (edit.data?.byteLength) parts.push(edit.data);
    at = edit.end;
  }
  if (at < file.size) parts.push(file.slice(at));
  return new Blob(parts, { type });
}

export async function readBytes(file: Blob, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

export function fourCC(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });
export function text(bytes: Uint8Array, start = 0, end = bytes.length): string {
  return utf8.decode(bytes.subarray(start, end));
}
