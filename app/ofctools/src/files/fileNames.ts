/** File-name and path helpers. Pure functions, so they can be tested without a device. */

// Characters that Android or iOS file systems reject, plus control characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_NAME_LENGTH = 120;
const MAX_EXTENSION_LENGTH = 12;

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  rtf: 'application/rtf',
  zip: 'application/zip',
};

/** "photo.final.jpg" → { base: "photo.final", ext: ".jpg" }. A name without a real extension keeps it all in `base`. */
export function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return { base: name, ext: '' };
  const ext = name.slice(dot);
  if (ext.length > MAX_EXTENSION_LENGTH || /\s/.test(ext))
    return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext };
}

/** A name that is safe to create on the device: no path separators, no hidden-file dot, a bounded length. */
export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned =
    name
      .replace(UNSAFE_CHARS, '_')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+/, '')
      .replace(/[.\s]+$/, '') || fallback;
  const { base, ext } = splitExtension(cleaned);
  const room = Math.max(1, MAX_NAME_LENGTH - ext.length);
  return (base.length > room ? base.slice(0, room).trimEnd() : base) + ext;
}

/** "report.pdf", 2 → "report (2).pdf". Zero returns the name unchanged. */
export function numberedName(name: string, n: number): string {
  if (n <= 0) return name;
  const { base, ext } = splitExtension(name);
  return `${base} (${n})${ext}`;
}

/** "report.pdf" → "report-143205.pdf", for when numbered names cannot be checked or keep failing. */
export function timestampedName(name: string, date: Date): string {
  const { base, ext } = splitExtension(name);
  const two = (v: number) => String(v).padStart(2, '0');
  return `${base}-${two(date.getHours())}${two(date.getMinutes())}${two(
    date.getSeconds(),
  )}${ext}`;
}

/** The first of "name", "name (1)", "name (2)"… that `isTaken` says is free. */
export async function uniqueName(
  name: string,
  isTaken: (candidate: string) => Promise<boolean>,
  limit = 200,
): Promise<string> {
  for (let n = 0; n < limit; n++) {
    const candidate = numberedName(name, n);
    if (!(await isTaken(candidate))) return candidate;
  }
  return timestampedName(name, new Date());
}

/** The type to hand the share sheet. Falls back to the type the web page reported, then to "any file". */
export function mimeFromName(name: string, reported = ''): string {
  const ext = splitExtension(name).ext.slice(1).toLowerCase();
  return (
    MIME_BY_EXTENSION[ext] ??
    (reported.split(';')[0].trim() || 'application/octet-stream')
  );
}

/** One type for a set of files: the shared type, the shared family ("image/*"), or any file. */
export function commonMime(types: string[]): string {
  if (types.length === 0) return '*/*';
  if (types.every(t => t === types[0])) return types[0];
  const family = types[0].split('/')[0];
  return types.every(t => t.split('/')[0] === family) ? `${family}/*` : '*/*';
}

/** Joins a folder and a name with exactly one slash; some platform folder paths end in a slash and some do not. */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;
}

/** A `file://` URL for a path, percent-encoded so names with spaces or brackets survive on both platforms. */
export function fileUrl(path: string): string {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`;
}
