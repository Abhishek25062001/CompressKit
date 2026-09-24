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
}

export interface BackgroundJobRequest {
  type: 'remove-background';
  jobId: string;
  file: File;
  settings: BackgroundSettings;
  /** Absolute URLs of the self-hosted model parts, and the checksum of the whole file. */
  model: { parts: string[]; size: number; sha256: string };
  /** Self-hosted ONNX Runtime WebAssembly files. */
  runtime: { wasm: string };
}
