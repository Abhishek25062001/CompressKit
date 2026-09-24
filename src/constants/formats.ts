import type { MediaKind } from '../types/media';

export interface FormatDef {
  kind: MediaKind;
  label: string;
  mimes: string[];
  extensions: string[];
  /** How to read dimensions and a thumbnail when it differs from the kind (an animated GIF is converted as video). */
  probeAs?: MediaKind;
}

export const INPUT_FORMATS: FormatDef[] = [
  { kind: 'image', label: 'JPG', mimes: ['image/jpeg', 'image/pjpeg'], extensions: ['jpg', 'jpeg', 'jfif'] },
  { kind: 'image', label: 'PNG', mimes: ['image/png', 'image/apng'], extensions: ['png'] },
  { kind: 'image', label: 'WebP', mimes: ['image/webp'], extensions: ['webp'] },
  { kind: 'image', label: 'AVIF', mimes: ['image/avif'], extensions: ['avif'] },
  { kind: 'video', label: 'MP4', mimes: ['video/mp4', 'video/x-m4v'], extensions: ['mp4', 'm4v'] },
  { kind: 'video', label: 'MOV', mimes: ['video/quicktime'], extensions: ['mov', 'qt'] },
  { kind: 'video', label: 'WebM', mimes: ['video/webm'], extensions: ['webm'] },
  { kind: 'video', label: 'MKV', mimes: ['video/x-matroska', 'video/matroska'], extensions: ['mkv'] },
];

/**
 * The converter also reads formats it never writes back out. The browser decodes BMP, libheif decodes
 * iPhone HEIC photos (natively in Safari); FFmpeg decodes
 * GIF (all frames, so it can become a video) and the older video containers.
 */
export const CONVERT_INPUT_FORMATS: FormatDef[] = [
  ...INPUT_FORMATS,
  { kind: 'image', label: 'BMP', mimes: ['image/bmp', 'image/x-ms-bmp'], extensions: ['bmp'] },
  {
    kind: 'image',
    label: 'HEIC',
    mimes: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
    extensions: ['heic', 'heif'],
  },
  { kind: 'video', label: 'GIF', mimes: ['image/gif'], extensions: ['gif'], probeAs: 'image' },
  { kind: 'video', label: 'AVI', mimes: ['video/x-msvideo', 'video/avi', 'video/msvideo'], extensions: ['avi'] },
  { kind: 'video', label: 'WMV', mimes: ['video/x-ms-wmv'], extensions: ['wmv'] },
  { kind: 'video', label: 'FLV', mimes: ['video/x-flv'], extensions: ['flv'] },
  { kind: 'video', label: '3GP', mimes: ['video/3gpp', 'video/3gpp2'], extensions: ['3gp', '3g2'] },
];

/**
 * Photos the resize tool can crop. HEIC is left out: its crop editor shows the photo in an <img>,
 * which only Safari can do for HEIC. Convert HEIC to JPG first.
 */
export const RESIZE_INPUT_FORMATS: FormatDef[] = CONVERT_INPUT_FORMATS.filter(
  (f) => f.kind === 'image' && f.label !== 'HEIC',
);

export const FORMAT_BADGES = ['JPG', 'PNG', 'WebP', 'AVIF', 'MP4', 'MOV', 'WebM', 'MKV'];
export const RESIZE_FORMAT_BADGES = RESIZE_INPUT_FORMATS.map((f) => f.label);
export const CONVERT_FORMAT_BADGES = [...FORMAT_BADGES, 'HEIC', 'BMP', 'GIF', 'AVI', 'WMV', 'FLV', '3GP'];

/** Value for a file input's accept attribute. */
export function acceptAttribute(formats: FormatDef[]): string {
  return formats.flatMap((f) => [...f.mimes, ...f.extensions.map((e) => `.${e}`)]).join(',');
}

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function detectFormat(file: File, formats: FormatDef[] = INPUT_FORMATS): FormatDef | null {
  const ext = getExtension(file.name);
  const mime = file.type.toLowerCase();
  return (
    formats.find((f) => mime !== '' && f.mimes.includes(mime)) ??
    formats.find((f) => f.extensions.includes(ext)) ??
    null
  );
}

/** Soft limits. Above these the app still tries, but warns the user. */
export const LARGE_IMAGE_BYTES = 60 * 1024 * 1024;
export const LARGE_VIDEO_BYTES = 1024 * 1024 * 1024;
/** Hard limit: WebAssembly memory cannot address more than this for FFmpeg output plus buffers. */
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 400 * 1024 * 1024;

export const IMAGE_MIME: Record<'jpeg' | 'webp' | 'avif' | 'png', string> = {
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  png: 'image/png',
};

export const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/png': 'png',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
};

export const MIME_LABEL: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  'image/png': 'PNG',
  'image/gif': 'GIF',
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
  'video/x-matroska': 'MKV',
  'audio/mpeg': 'MP3',
  'audio/mp4': 'M4A',
  'audio/wav': 'WAV',
};
