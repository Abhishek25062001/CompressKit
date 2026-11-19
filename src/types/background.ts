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
   * Show raw matte, refined matte, and composites on white/dark so you can see which stage
   * causes halo, seams or washout. The downloadable cut-out is still produced.
   */
  debugMatte: boolean;
}

/** Object URLs for the four debug stage panels (revoked with the result). */
export interface CutoutDebugPreviews {
  rawMatteUrl: string;
  refinedMatteUrl: string;
  onWhiteUrl: string;
  onDarkUrl: string;
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
  /** Self-hosted ONNX Runtime WebAssembly files. */
  runtime: { wasm: string };
}
