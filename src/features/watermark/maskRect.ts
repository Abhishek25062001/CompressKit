import type { QueueItem } from '../../types/media';

/** Suggested mark when the user has not drawn one yet: bottom-right, typical logo spot. */
export const DEFAULT_WATERMARK_MASK = { x: 0.72, y: 0.86, width: 0.24, height: 0.1 };

/**
 * Use the user's saved rectangle whenever `item.crop` exists. The default is only a fallback when
 * they never opened Mark watermark — it must not replace a saved mark.
 */
export function resolveMaskRect(item: QueueItem): {
  rect: NonNullable<QueueItem['crop']>['rect'];
  usedDefault: boolean;
} {
  if (item.crop?.rect) return { rect: item.crop.rect, usedDefault: false };
  return { rect: DEFAULT_WATERMARK_MASK, usedDefault: true };
}
