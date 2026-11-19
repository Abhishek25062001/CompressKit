import type { ModelFiles } from './background';
import type { CropRect } from './resize';

/** Output format for a cleaned photo. */
export type WatermarkFormat = 'png' | 'webp' | 'jpeg' | 'original';

export interface WatermarkSettings {
  format: WatermarkFormat;
  /**
   * Extra pixels around the marked rectangle that are also filled, so hard logo edges blend
   * into the surroundings.
   */
  expand: number;
  /**
   * When true, paint the final mask magenta and skip inpainting so you can see exactly which
   * pixels would be filled (after expand + glow grow).
   */
  debugMask: boolean;
}

export interface WatermarkJobRequest {
  type: 'remove-watermark';
  jobId: string;
  file: File;
  /** Watermark area as fractions of the photo (0..1). */
  mask: CropRect;
  settings: WatermarkSettings;
  /**
   * Self-hosted LaMa parts: `gpu` (fp16 WebGPU graph) and `cpu` (int8 WASM).
   * Null when not included in this build — the worker then uses the classical fill.
   */
  models?: { gpu: ModelFiles | null; cpu: ModelFiles | null };
  /** Self-hosted ONNX Runtime WebAssembly files. */
  runtime?: { wasm: string };
}
