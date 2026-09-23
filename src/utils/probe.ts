import type { MediaMeta } from '../types/media';

const THUMB_SIZE = 320;

export interface ProbeResult {
  meta: MediaMeta;
  thumbUrl: string | null;
}

function canvasToUrl(canvas: HTMLCanvasElement, mime = 'image/webp'): Promise<string | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob ? URL.createObjectURL(blob) : null),
      mime,
      0.8,
    );
  });
}

function drawThumb(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement | null {
  const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Reads image dimensions and renders a small thumbnail so the queue never holds full-size decodes. */
export async function probeImage(file: Blob): Promise<ProbeResult> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const canvas = drawThumb(img, width, height);
    const thumbUrl = canvas ? await canvasToUrl(canvas) : null;
    return { meta: { width, height, probed: true }, thumbUrl };
  } catch {
    return { meta: { probed: false }, thumbUrl: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function waitFor(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('media error'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener('error', onErr, { once: true });
  });
}

/**
 * Reads duration and dimensions with a detached video element and grabs a poster frame.
 * If the browser cannot play the container or codec, the file is still accepted: FFmpeg may handle it.
 */
export async function probeVideo(file: Blob, withThumb = true): Promise<ProbeResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  try {
    video.src = url;
    await waitFor(video, 'loadedmetadata', 10_000);
    const width = video.videoWidth || undefined;
    const height = video.videoHeight || undefined;
    const duration = Number.isFinite(video.duration) ? video.duration : undefined;
    let thumbUrl: string | null = null;
    if (withThumb && width && height) {
      try {
        video.currentTime = Math.min(1, (duration ?? 1) * 0.1);
        await waitFor(video, 'seeked', 8_000);
        const canvas = drawThumb(video, width, height);
        thumbUrl = canvas ? await canvasToUrl(canvas) : null;
      } catch {
        thumbUrl = null;
      }
    }
    return { meta: { width, height, duration, probed: !!(width && height) }, thumbUrl };
  } catch {
    return { meta: { probed: false }, thumbUrl: null };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
