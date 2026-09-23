import type { ImageSettings, VideoSettings } from './settings';

export type MediaKind = 'image' | 'video';

export type FileStatus = 'waiting' | 'compressing' | 'completed' | 'failed' | 'cancelled';

export type ErrorCode =
  | 'UNSUPPORTED_TYPE'
  | 'DECODE_FAILED'
  | 'ENCODE_UNSUPPORTED'
  | 'CODEC_UNSUPPORTED'
  | 'ENGINE_LOAD_FAILED'
  | 'OUT_OF_MEMORY'
  | 'WORKER_CRASHED'
  | 'NO_VIDEO_TRACK'
  | 'FILE_TOO_LARGE'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface FriendlyError {
  code: ErrorCode;
  title: string;
  message: string;
}

export interface MediaMeta {
  width?: number;
  height?: number;
  /** Seconds, videos only. */
  duration?: number;
  /** Whether the browser could read the file's metadata (it may still be processable by FFmpeg). */
  probed: boolean;
}

export type VideoEngine = 'webcodecs' | 'ffmpeg';

export interface CompressionResult {
  blob: Blob;
  url: string;
  fileName: string;
  mime: string;
  formatLabel: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  elapsedMs: number;
  engine: 'canvas' | 'wasm-avif' | 'upng' | VideoEngine | 'original';
  /** Human readable notes, for example "Kept transparency: saved as WebP". */
  notes: string[];
  /** True when the original file was returned because re-encoding would not have made it smaller. */
  keptOriginal: boolean;
}

export interface FileSettingsOverride {
  image?: ImageSettings;
  video?: VideoSettings;
}

export interface QueueItem {
  id: string;
  file: File;
  kind: MediaKind;
  name: string;
  size: number;
  mime: string;
  /** Upper case extension label, e.g. "JPG". */
  typeLabel: string;
  /** Object URL of a thumbnail (image original or video poster frame). */
  thumbUrl: string | null;
  meta: MediaMeta;
  status: FileStatus;
  /** 0..1 when known, null when progress cannot be measured honestly. */
  progress: number | null;
  stage: string | null;
  result: CompressionResult | null;
  error: FriendlyError | null;
  override: FileSettingsOverride | null;
  warning: string | null;
}
