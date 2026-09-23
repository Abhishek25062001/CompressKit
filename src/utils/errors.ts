import type { ErrorCode } from '../types/media';

/** Error carrying a user-facing error code. Thrown inside workers and engines. */
export class CompressionError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, detail?: string) {
    super(detail ?? code);
    this.code = code;
    this.name = 'CompressionError';
  }
}

/** Maps any thrown value to an error code without leaking internals to the UI. */
export function classifyError(error: unknown): ErrorCode {
  if (error instanceof CompressionError) return error.code;
  const text = describeError(error).toLowerCase();
  if (
    text.includes('out of memory') ||
    text.includes('memory access out of bounds') ||
    text.includes('cannot enlarge memory') ||
    text.includes('allocation failed') ||
    text.includes('array buffer allocation') ||
    text.includes('rangeerror')
  ) {
    return 'OUT_OF_MEMORY';
  }
  if (text.includes('abort') && text.includes('cancel')) return 'CANCELLED';
  if (text.includes('decode') || text.includes('invalidstate') || text.includes('source image')) {
    return 'DECODE_FAILED';
  }
  return 'UNKNOWN';
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
