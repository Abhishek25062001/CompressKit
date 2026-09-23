/** Synchronous feature detection. Safe to call during render. */
export interface BrowserSupport {
  workers: boolean;
  webAssembly: boolean;
  webCodecs: boolean;
  offscreenCanvas: boolean;
  createImageBitmap: boolean;
  crossOriginIsolated: boolean;
  serviceWorker: boolean;
}

export function detectBrowserSupport(): BrowserSupport {
  const w = typeof window !== 'undefined' ? window : undefined;
  return {
    workers: typeof Worker !== 'undefined',
    webAssembly: typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function',
    webCodecs: !!w && 'VideoEncoder' in w && 'VideoDecoder' in w && 'VideoFrame' in w,
    offscreenCanvas:
      typeof OffscreenCanvas !== 'undefined' &&
      typeof OffscreenCanvas.prototype.convertToBlob === 'function' &&
      typeof OffscreenCanvas.prototype.getContext === 'function',
    createImageBitmap: typeof createImageBitmap === 'function',
    crossOriginIsolated: !!w && w.crossOriginIsolated === true,
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  };
}
