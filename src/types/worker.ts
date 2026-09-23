import type { AudioTarget } from './convert';
import type { ImageTransform } from './resize';
import type { ErrorCode, ToolMode, VideoEngine } from './media';
import type { ImageSettings, VideoSettings } from './settings';

/** What a video job produces. Only the converter asks for a GIF or an audio file. */
export type VideoOutput =
  | { type: 'video' }
  | { type: 'gif'; /** Null keeps the source width. */ width: number | null; fps: number }
  | { type: 'audio'; format: AudioTarget };

export interface ImageJobRequest {
  type: 'compress';
  jobId: string;
  file: File;
  settings: ImageSettings;
  /** In 'convert' mode the requested format is always written, even when the file does not get smaller. */
  mode: ToolMode;
  /** Resize tool only: crop, then scale to an exact size. */
  transform?: ImageTransform;
  /** Encoders the main thread already verified, so the worker does not need to re-test them. */
  support: { webp: boolean; avif: boolean };
}

export interface VideoJobRequest {
  type: 'compress';
  jobId: string;
  file: File;
  settings: VideoSettings;
  mode: ToolMode;
  output: VideoOutput;
  source: {
    width?: number;
    height?: number;
    duration?: number;
  };
  /** URLs of the self-hosted FFmpeg core files. */
  ffmpeg: { coreURL: string; wasmURL: string };
}

export interface WorkerProgressMessage {
  type: 'progress';
  jobId: string;
  /** 0..1, or null when the worker cannot measure progress. */
  progress: number | null;
  stage: string;
}

export interface WorkerDoneMessage {
  type: 'done';
  jobId: string;
  blob: Blob;
  mime: string;
  width?: number;
  height?: number;
  notes: string[];
  engine: string;
  keptOriginal: boolean;
}

export interface WorkerErrorMessage {
  type: 'error';
  jobId: string;
  code: ErrorCode;
  /** Internal detail for the console. Never rendered to users. */
  detail: string;
}

export type WorkerResponse = WorkerProgressMessage | WorkerDoneMessage | WorkerErrorMessage;

export type { VideoEngine };
