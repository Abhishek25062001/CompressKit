import type { MediaKind } from '../types/media';

interface FormatDef {
  kind: MediaKind;
  label: string;
  mimes: string[];
  extensions: string[];
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

export const FORMAT_BADGES = ['JPG', 'PNG', 'WebP', 'AVIF', 'MP4', 'MOV', 'WebM', 'MKV'];

/** Value for the file input's accept attribute. */
export const ACCEPT_ATTRIBUTE = INPUT_FORMATS.flatMap((f) => [
  ...f.mimes,
  ...f.extensions.map((e) => `.${e}`),
]).join(',');

export function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function detectFormat(file: File): FormatDef | null {
  const ext = getExtension(file.name);
  const mime = file.type.toLowerCase();
  return (
    INPUT_FORMATS.find((f) => mime !== '' && f.mimes.includes(mime)) ??
    INPUT_FORMATS.find((f) => f.extensions.includes(ext)) ??
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
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export const MIME_LABEL: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  'image/png': 'PNG',
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
};
