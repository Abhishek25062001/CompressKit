const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  const digits = exp === 0 ? 0 : value >= 100 ? 0 : decimals;
  return `${value.toFixed(digits)} ${UNITS[exp]}`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return 'Unknown';
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
}

export function formatDimensions(width?: number, height?: number): string {
  return width && height ? `${width} × ${height}` : 'Unknown';
}

/** Positive when the file got smaller. */
export function savedRatio(original: number, compressed: number): number {
  if (original <= 0) return 0;
  return (original - compressed) / original;
}

export function formatPercent(ratio: number): string {
  const pct = ratio * 100;
  return `${Math.abs(pct) >= 10 ? pct.toFixed(0) : pct.toFixed(1)}%`;
}
