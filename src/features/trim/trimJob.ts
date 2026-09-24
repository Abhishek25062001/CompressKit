import ffmpegCoreUrl from '@ffmpeg/core?url';
import ffmpegWasmUrl from '@ffmpeg/core/wasm?url';
import { toFriendlyError } from '../../constants/errors';
import { INPUT_FORMATS, MAX_VIDEO_BYTES, MIME_EXTENSION, detectFormat } from '../../constants/formats';
import { useTrimStore, type TrimPart } from '../../store/trimStore';
import { useUiStore } from '../../store/uiStore';
import type { TrimJobRequest, TrimWorkerResponse } from '../../types/trim';
import { downloadBlob } from '../../utils/download';
import { formatBytes } from '../../utils/format';
import { sanitizeBaseName } from '../../utils/filename';
import { probeVideo } from '../../utils/probe';
import { createZip } from '../../utils/zip';
import { WorkerSlot } from '../compression/workerSlot';

/** The trim tool takes the same videos as the compressor. */
export const TRIM_INPUT_FORMATS = INPUT_FORMATS.filter((f) => f.kind === 'video');
export const TRIM_BADGES = TRIM_INPUT_FORMATS.map((f) => f.label);

/** Shortest clip the tool will produce, in seconds. */
export const MIN_CLIP_SECONDS = 0.5;

const slot = new WorkerSlot(
  () => new Worker(new URL('../../workers/trim.worker.ts', import.meta.url), { type: 'module', name: 'compresskit-trim' }),
  60_000,
);
let jobSeq = 0;

/** Duration from the container, for files the browser cannot play (for example HEVC in some browsers). */
async function durationFromContainer(file: File): Promise<number | undefined> {
  try {
    const { ALL_FORMATS, BlobSource, Input } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const duration = await input.computeDuration();
      return Number.isFinite(duration) && duration > 0 ? duration : undefined;
    } finally {
      input.dispose();
    }
  } catch {
    return undefined;
  }
}

/** Opens the first supported video from a drop, paste or file dialog. */
export async function loadTrimFile(files: Iterable<File>): Promise<void> {
  const notice = useUiStore.getState().pushNotice;
  const list = Array.from(files);
  const picked = list.find((f) => detectFormat(f, TRIM_INPUT_FORMATS));
  if (!picked) {
    if (list.length) {
      notice({ tone: 'warning', title: 'Not a supported video', message: 'The trimmer opens MP4, MOV, WebM and MKV videos.' });
    }
    return;
  }
  if (picked.size > MAX_VIDEO_BYTES) {
    notice({ tone: 'error', title: 'This video is too large', message: `Videos up to ${formatBytes(MAX_VIDEO_BYTES)} can be trimmed in the browser.` });
    return;
  }
  if (list.length > 1) {
    notice({ tone: 'info', title: 'One video at a time', message: `Opened ${picked.name}. The trimmer works on a single video.` });
  }
  if (useTrimStore.getState().status === 'running') cancelTrim();

  const format = detectFormat(picked, TRIM_INPUT_FORMATS)!;
  // Normalize a missing MIME type (common for MKV/MOV on some systems) so engines can rely on it.
  const file = picked.type ? picked : new File([picked], picked.name, { type: format.mimes[0], lastModified: picked.lastModified });

  const store = useTrimStore.getState();
  store.setLoading(true);
  const probe = await probeVideo(file, false);
  const duration = probe.meta.duration && probe.meta.duration > 0 ? probe.meta.duration : await durationFromContainer(file);
  if (!duration) {
    store.setLoading(false);
    notice({ tone: 'error', title: "We couldn't read this video", message: 'The file may be damaged, or its format is not supported.' });
    return;
  }
  store.setSource({
    file,
    url: URL.createObjectURL(file),
    name: file.name,
    duration,
    width: probe.meta.width,
    height: probe.meta.height,
    playable: probe.meta.probed,
  });
}

function partFileName(sourceName: string, mime: string, index: number, total: number, split: boolean): string {
  const base = sanitizeBaseName(sourceName);
  const ext = MIME_EXTENSION[mime] ?? 'mp4';
  if (!split) return `${base}-trimmed.${ext}`;
  const width = String(total).length;
  return `${base}-part-${String(index + 1).padStart(width, '0')}-of-${total}.${ext}`;
}

export function startTrim(): void {
  const state = useTrimStore.getState();
  const { source, range, settings } = state;
  if (!source || state.status === 'running') return;
  const split = settings.mode === 'split';
  const jobId = `trim-${++jobSeq}`;
  const startedAt = performance.now();
  state.startJob();

  const request: TrimJobRequest = {
    type: 'trim',
    jobId,
    file: source.file,
    range,
    partSeconds: split ? settings.partSeconds : null,
    method: settings.method,
    resolution: settings.resolution,
    keepAudio: settings.keepAudio,
    source: { width: source.width, height: source.height, duration: source.duration },
    ffmpeg: {
      coreURL: new URL(ffmpegCoreUrl, window.location.href).href,
      wasmURL: new URL(ffmpegWasmUrl, window.location.href).href,
    },
  };

  slot.run<TrimWorkerResponse>(jobId, request, {
    onMessage: (msg) => {
      const store = useTrimStore.getState();
      if (store.status !== 'running') return;
      if (msg.type === 'progress') {
        store.setProgress(msg.progress, msg.stage);
      } else if (msg.type === 'error') {
        console.warn(`[CompressKit] ${msg.code}:`, msg.detail);
        store.failJob(toFriendlyError(msg.code));
      } else {
        const parts: TrimPart[] = msg.parts.map((p, i) => ({
          blob: p.blob,
          url: URL.createObjectURL(p.blob),
          fileName: partFileName(source.name, msg.mime, i, msg.parts.length, split),
          start: p.start,
          end: p.end,
        }));
        store.finishJob({ parts, notes: msg.notes, engine: msg.engine, elapsedMs: performance.now() - startedAt });
      }
    },
    onCrash: (detail) => {
      console.warn('[CompressKit] WORKER_CRASHED:', detail);
      useTrimStore.getState().failJob(toFriendlyError('WORKER_CRASHED'));
    },
  });
}

/** Stops the running job by terminating its worker, which frees its memory at once. */
export function cancelTrim(): void {
  slot.terminate();
  useTrimStore.getState().failJob(null);
}

export function clearTrim(): void {
  if (useTrimStore.getState().status === 'running') cancelTrim();
  useTrimStore.getState().clear();
}

export function downloadPart(part: TrimPart): void {
  downloadBlob(part.blob, part.fileName);
}

/** One part downloads directly; several are bundled into a ZIP built in the browser. */
export async function downloadAllParts(onProgress?: (ratio: number) => void): Promise<void> {
  const { parts, source } = useTrimStore.getState();
  if (parts.length === 0) return;
  if (parts.length === 1) {
    downloadPart(parts[0]);
    return;
  }
  const zip = await createZip(parts.map((p) => ({ name: p.fileName, blob: p.blob })), onProgress);
  downloadBlob(zip, `${sanitizeBaseName(source?.name ?? 'video')}-parts.zip`);
}

function partFiles(parts: TrimPart[]): File[] {
  return parts.map((p) => new File([p.blob], p.fileName, { type: p.blob.type }));
}

/** True when the system share sheet can take these videos, e.g. to post them to a WhatsApp status from a phone. */
export function canShareParts(parts: TrimPart[]): boolean {
  if (parts.length === 0 || typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: partFiles(parts) });
  } catch {
    return false;
  }
}

export async function shareParts(parts: TrimPart[]): Promise<void> {
  try {
    await navigator.share({ files: partFiles(parts) });
  } catch (error) {
    // Closing the share sheet is not an error worth reporting.
    if (error instanceof DOMException && error.name === 'AbortError') return;
    useUiStore.getState().pushNotice({ tone: 'warning', title: 'Sharing failed', message: 'Download the videos instead, then share them from your gallery.' });
  }
}
