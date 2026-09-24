const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "1:05.3" or "1:02:03.4": clip times need tenths of a second, unlike file durations. */
export function formatClock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const s = Math.floor((tenths % 600) / 10);
  const clock = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return `${clock}.${tenths % 10}`;
}

/** Short spoken-style length, e.g. "1 min 30 s" or "12.5 s". */
export function formatLength(seconds: number): string {
  if (seconds < 60) return `${Number(seconds.toFixed(1))} s`;
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/** Reads "75", "1:15", "1:15.5" or "0:01:15". Returns null for anything else. */
export function parseClock(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  // Only the last field may have a fraction.
  if (nums.slice(0, -1).some((n) => !Number.isInteger(n))) return null;
  return nums.reduce((total, n) => total * 60 + n, 0);
}
