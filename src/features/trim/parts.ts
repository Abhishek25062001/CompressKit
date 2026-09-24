import type { TimeRange } from '../../types/trim';

/** Leftovers shorter than this at the end are dropped: they would be a blink of video. */
export const MIN_PART_SECONDS = 0.1;

/**
 * Consecutive parts of at most `partSeconds` covering the range, e.g. 150 s at 60 s → 60, 60, 30.
 * Null keeps the range whole.
 *
 * `margin` shortens each part so that re-encoded audio, which an AAC encoder pads by a few dozen
 * milliseconds, still ends within the limit. It never adds a part: when the range is almost an
 * exact multiple of the limit, the parts are made equal instead.
 */
export function splitRange(range: TimeRange, partSeconds: number | null, margin = 0): TimeRange[] {
  const length = range.end - range.start;
  if (partSeconds === null) return [range];
  // A leftover shorter than MIN_PART_SECONDS is dropped rather than becoming a part of its own.
  const count = Math.max(1, Math.ceil((length - MIN_PART_SECONDS) / partSeconds - 1e-6));
  const limit = partSeconds - margin;
  const size = count * limit >= length ? limit : Math.min(partSeconds, length / count);
  return Array.from({ length: count }, (_, i) => ({
    start: range.start + i * size,
    end: Math.min(range.end, range.start + (i + 1) * size),
  }));
}
