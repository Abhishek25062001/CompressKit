import type { HiddenInfo } from './clean';
import type { ItemCrop } from './resize';
import type { ImageSettings, VideoSettings } from './settings';

export type MediaKind = 'image' | 'video';

/**
 * Which tool a queue belongs to: shrinking files, changing their format, cropping them to a size,
 * removing hidden details such as location, or cutting the subject out of a photo.
 */
export type ToolMode = 'compress' | 'convert' | 'resize' | 'clean' | 'background';

/**
 * Tabs of the workspace: the queue tools, plus the video trimmer (one video on a timeline) and the
 * PDF tool (pages instead of a file queue).
 */
export type WorkspaceTab = ToolMode | 'trim' | 'pdf';

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
  | 'NO_AUDIO_TRACK'
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
  engine: 'canvas' | 'wasm-avif' | 'upng' | VideoEngine | 'original' | 'metadata' | 'webgpu' | 'wasm';
  /** Human readable notes, for example "Kept transparency: saved as WebP". */
  notes: string[];
  /** True when the original file was returned because re-encoding would not have made it smaller. */
  keptOriginal: boolean;
  /** Clean tool: the hidden details that were taken out. */
  removed?: HiddenInfo[];
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
  /** Crop drawn in the resize tool. Null uses a centered crop. */
  crop: ItemCrop | null;
  warning: string | null;
  /** Clean tool: hidden details found in the file. Undefined until the file has been read. */
  hidden?: HiddenInfo[];
}
