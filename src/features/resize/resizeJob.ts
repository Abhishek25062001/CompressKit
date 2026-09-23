import { DEFAULT_IMAGE_SETTINGS } from '../../constants/presets';
import { MAX_CUSTOM_SIDE, RESIZE_PRESETS } from '../../constants/resizePresets';
import type { QueueItem } from '../../types/media';
import type { CropRect, ImageTransform, ItemCrop, ResizeSettings } from '../../types/resize';
import type { ImageSettings } from '../../types/settings';

/** High enough that resizing never visibly degrades the picture; a KB limit overrides it. */
const RESIZE_QUALITY = 92;

/** The whole image, used by a freehand crop the user has not drawn yet. */
export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** Exact output size, or null for freehand, where the output is the cropped area itself. */
export function outputSize(s: ResizeSettings): { width: number; height: number } | null {
  if (s.preset === 'freehand') return null;
  const preset = RESIZE_PRESETS.find((p) => p.id === s.preset);
  if (preset) return { width: preset.width, height: preset.height };
  const clamp = (n: number) => Math.min(MAX_CUSTOM_SIDE, Math.max(1, Math.round(n) || 1));
  return { width: clamp(s.customWidth), height: clamp(s.customHeight) };
}

/** Aspects closer than this are treated as equal, so rounding never throws away a user's crop. */
export function sameAspect(a: number, b: number): boolean {
  return Math.abs(a - b) / b < 0.005;
}

/** The largest crop of the given output aspect, centered in an image of the given size. */
export function centeredCrop(imageWidth: number, imageHeight: number, aspect: number): CropRect {
  const imageAspect = imageWidth / imageHeight;
  if (imageAspect > aspect) {
    const width = aspect / imageAspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imageAspect / aspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function resizeImageSettings(s: ResizeSettings): ImageSettings {
  return {
    ...DEFAULT_IMAGE_SETTINGS,
    format: s.format,
    quality: s.format === 'png' ? 100 : RESIZE_QUALITY,
    preserveResolution: true,
    targetKB: s.targetKB,
  };
}

/** Whether a saved crop still applies. Freehand accepts any crop; a preset needs one drawn for its shape. */
export function cropFits(crop: ItemCrop | null, aspect: number | null): crop is ItemCrop {
  if (!crop) return false;
  if (aspect === null) return true;
  return crop.aspect !== null && sameAspect(crop.aspect, aspect);
}

export function resizeTransform(item: QueueItem, s: ResizeSettings): ImageTransform {
  const size = outputSize(s);
  const crop = cropFits(item.crop, size ? size.width / size.height : null) ? item.crop.rect : null;
  return { crop, width: size?.width ?? null, height: size?.height ?? null };
}
