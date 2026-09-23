// Characters that are invalid in file names on Windows, macOS or Linux, plus control characters.
// eslint-disable-next-line no-control-regex
const INVALID = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Produces a safe base name without an extension. */
export function sanitizeBaseName(name: string): string {
  let base = stripExtension(name)
    .normalize('NFC')
    .replace(INVALID, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (!base || RESERVED.test(base)) base = `file${base ? `_${base}` : ''}`;
  return base.slice(0, 120);
}

export function buildOutputName(originalName: string, extension: string, keptOriginal = false): string {
  const base = sanitizeBaseName(originalName);
  return keptOriginal ? `${base}.${extension}` : `${base}-compressed.${extension}`;
}

/** Makes names unique within a set, e.g. for ZIP entries. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) {
    taken.add(name.toLowerCase());
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  while (taken.has(`${base} (${i})${ext}`.toLowerCase())) i++;
  const next = `${base} (${i})${ext}`;
  taken.add(next.toLowerCase());
  return next;
}
