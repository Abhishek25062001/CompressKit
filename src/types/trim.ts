import type { ErrorCode } from './media';
import type { VideoResolution } from './settings';

/** Keep one part of a video, or cut it into parts short enough for a status or story. */
export type TrimMode = 'trim' | 'split';

/**
 * 'fast' copies the encoded video without re-encoding: no quality loss and very quick, but cuts land on
 * key frames. 'precise' re-encodes to H.264 MP4 so every cut lands on the exact frame.
 */
export type CutMethod = 'fast' | 'precise';

export interface TimeRange {
  /** Seconds from the start of the video. */
  start: number;
  end: number;
}

export interface TrimSettings {
  mode: TrimMode;
  method: CutMethod;
  /** Longest allowed part when splitting, in seconds. */
  partSeconds: number;
  /** Short-side cap for precise cuts. */
  resolution: VideoResolution;
  keepAudio: boolean;
}

export interface TrimJobRequest {
  type: 'trim';
  jobId: string;
  file: File;
  range: TimeRange;
  /** Null keeps the range as one clip. */
  partSeconds: number | null;
  method: CutMethod;
  resolution: VideoResolution;
  keepAudio: boolean;
  source: { width?: number; height?: number; duration?: number };
  ffmpeg: { coreURL: string; wasmURL: string };
}

export interface TrimPartOutput {
  blob: Blob;
  /** Where the part sits in the source, in seconds. May differ slightly from the request for fast cuts. */
  start: number;
  end: number;
}

export interface TrimDoneMessage {
  type: 'done';
  jobId: string;
  parts: TrimPartOutput[];
  mime: string;
  engine: 'copy' | 'webcodecs' | 'ffmpeg';
  notes: string[];
}

export interface TrimProgressMessage {
  type: 'progress';
  jobId: string;
  progress: number | null;
  stage: string;
}

export interface TrimErrorMessage {
  type: 'error';
  jobId: string;
  code: ErrorCode;
  detail: string;
}

export type TrimWorkerResponse = TrimProgressMessage | TrimDoneMessage | TrimErrorMessage;
