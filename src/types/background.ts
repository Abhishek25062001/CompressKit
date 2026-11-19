/** What goes behind the cut-out subject. */
export type CutoutBackground = 'transparent' | 'white' | 'color';
export type CutoutFormat = 'png' | 'webp' | 'jpeg';

export interface BackgroundSettings {
  background: CutoutBackground;
  /** CSS hex colour, used when background is 'color'. */
  color: string;
  /** JPEG is only offered for a solid background, since it has no transparency. */
  format: CutoutFormat;
  /** Crop the result to the subject, with a small margin. */
  trim: boolean;
  /**
   * Show raw matte, refined matte, and composites on white, black and green so you can see which stage
   * causes halo, seams or washout. The downloadable cut-out is still produced.
   */
  debugMatte: boolean;
}

/** Object URLs for the debug stage panels (revoked with the result). */
export interface CutoutDebugPreviews {
  rawMatteUrl: string;
  refinedMatteUrl: string;
  onWhiteUrl: string;
  onBlackUrl: string;
  onColorUrl: string;
}

export interface ModelFiles {
  parts: string[];
  size: number;
  sha256: string;
}

export interface BackgroundJobRequest {
  type: 'remove-background';
  jobId: string;
  file: File;
  settings: BackgroundSettings;
  /**
   * Absolute URLs of each self-hosted model's parts, and the checksum of the whole file: `gpu` is
   * used when the browser has a suitable graphics card, `cpu` otherwise. Null when not in this build.
   */
  models: { gpu: ModelFiles | null; cpu: ModelFiles | null };
  /**
   * Self-hosted ONNX Runtime WebAssembly file, threads (used only when the page is cross-origin
   * isolated) and the session's CPU memory options.
   */
  runtime: { wasm: string; threads: number; memArena: boolean; memPattern: boolean };
  /** Skip the graphics card: it failed earlier in this page, so the processor model runs. */
  forceCpu: boolean;
  /**
   * Keep model parts in Cache Storage. False inside the Android/iOS app, where they are already
   * files on the phone and a cache would store a second copy (100+ MB per model).
   */
  cacheModel: boolean;
}

/** Sent instead of a result when the graphics card cannot start or run the model; the page retries on the processor in a fresh worker. */
export interface GpuFailedMessage {
  type: 'gpu-failed';
  jobId: string;
  detail: string;
}
