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
}

export interface WatermarkJobRequest {
  type: 'remove-watermark';
  jobId: string;
  file: File;
  /** Watermark area as fractions of the photo (0..1). */
  mask: CropRect;
  settings: WatermarkSettings;
}
