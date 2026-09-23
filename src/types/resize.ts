/** A crop rectangle as fractions (0..1) of the oriented source image. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A crop the user drew, remembered with the output aspect it was drawn for. */
export interface ItemCrop {
  rect: CropRect;
  /** Output width / height when the crop was drawn, or null for a freehand crop. A different preset aspect discards it. */
  aspect: number | null;
}

export type ResizePresetId =
  | 'passport'
  | 'us-passport'
  | 'signature'
  | 'profile'
  | 'instagram-post'
  | 'instagram-portrait'
  | 'story'
  | 'youtube-thumbnail'
  | 'x-header'
  | 'linkedin-banner'
  | 'custom'
  /** Any rectangle, at the original resolution. */
  | 'freehand';

export type ResizeFormat = 'jpeg' | 'png' | 'webp';

export interface ResizeSettings {
  preset: ResizePresetId;
  /** Output size for the custom preset, in pixels. */
  customWidth: number;
  customHeight: number;
  format: ResizeFormat;
  /** Optional upload limit in KB, as forms often require. Null means no limit. */
  targetKB: number | null;
}

/** Sent with an image job: crop this part of the image, then scale it to exactly this size. */
export interface ImageTransform {
  /** Null centers the largest crop of the right aspect, or keeps the whole image when freehand. */
  crop: CropRect | null;
  /** Null (freehand) keeps the cropped area at its own pixel size. */
  width: number | null;
  height: number | null;
}
