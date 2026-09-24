import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { MIN_CLIP_SECONDS } from '../../features/trim/trimJob';
import { formatClock } from '../../features/trim/time';
import type { TimeRange } from '../../types/trim';
import { cn } from '../../utils/cn';

const THUMB_COUNT = 10;
const THUMB_HEIGHT = 64;

/**
 * Frames spread across the video for the timeline background. A separate, detached video element
 * seeks to each point so the preview player is left alone.
 */
function useThumbnails(url: string, duration: number, enabled: boolean): string[] {
  const [thumbs, setThumbs] = useState<{ url: string; list: string[] }>({ url: '', list: [] });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const seek = (t: number) =>
      new Promise<void>((resolve, reject) => {
        const done = () => {
          video.removeEventListener('seeked', done);
          video.removeEventListener('error', fail);
          resolve();
        };
        const fail = () => reject(new Error('seek failed'));
        video.addEventListener('seeked', done);
        video.addEventListener('error', fail);
        video.currentTime = t;
      });

    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          video.addEventListener('loadeddata', () => resolve(), { once: true });
          video.addEventListener('error', () => reject(new Error('load failed')), { once: true });
        });
        if (!ctx || !video.videoWidth) return;
        canvas.height = THUMB_HEIGHT * 2;
        canvas.width = Math.round((video.videoWidth / video.videoHeight) * canvas.height);
        const list: string[] = [];
        for (let i = 0; i < THUMB_COUNT && !cancelled; i++) {
          await seek(((i + 0.5) / THUMB_COUNT) * duration);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          list.push(canvas.toDataURL('image/webp', 0.6));
          if (!cancelled) setThumbs({ url, list: [...list] });
        }
      } catch {
        // No thumbnails: the timeline still works without them.
      } finally {
        video.removeAttribute('src');
        video.load();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, duration, enabled]);

  return thumbs.url === url ? thumbs.list : [];
}

interface TimelineProps {
  url: string;
  duration: number;
  playable: boolean;
  range: TimeRange;
  onRangeChange: (range: TimeRange) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  /** Where parts will be cut, drawn as markers inside the selection. */
  cuts: number[];
}

type Drag = 'start' | 'end' | 'seek';

export function Timeline({ url, duration, playable, range, onRangeChange, currentTime, onSeek, cuts }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const thumbs = useThumbnails(url, duration, playable);
  const pct = (t: number) => `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%`;
  const minLength = Math.min(MIN_CLIP_SECONDS, duration);

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  };

  const setStart = (t: number) => {
    const start = Math.min(Math.max(0, t), range.end - minLength);
    onRangeChange({ start, end: range.end });
    onSeek(start);
  };
  const setEnd = (t: number) => {
    const end = Math.max(Math.min(duration, t), range.start + minLength);
    onRangeChange({ start: range.start, end });
    onSeek(end);
  };

  const apply = (kind: Drag, t: number) => {
    if (kind === 'start') setStart(t);
    else if (kind === 'end') setEnd(t);
    else onSeek(t);
  };

  const beginDrag = (kind: Drag, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current = kind;
    trackRef.current?.setPointerCapture(e.pointerId);
    // Handles move with the pointer from here on; a press on the bar seeks straight away.
    if (kind === 'seek') onSeek(timeAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) apply(drag.current, timeAt(e.clientX));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (trackRef.current?.hasPointerCapture(e.pointerId)) trackRef.current.releasePointerCapture(e.pointerId);
  };

  const onHandleKey = (kind: 'start' | 'end') => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 0.1;
    const value = kind === 'start' ? range.start : range.end;
    const set = kind === 'start' ? setStart : setEnd;
    const keys: Record<string, number> = {
      ArrowLeft: value - step,
      ArrowDown: value - step,
      ArrowRight: value + step,
      ArrowUp: value + step,
      PageDown: value - 5,
      PageUp: value + 5,
      Home: 0,
      End: duration,
    };
    if (e.key in keys) {
      e.preventDefault();
      set(keys[e.key]);
    }
  };

  const handle = (kind: 'start' | 'end') => {
    const value = kind === 'start' ? range.start : range.end;
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={kind === 'start' ? 'Clip start' : 'Clip end'}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuetext={formatClock(value)}
        onPointerDown={(e) => beginDrag(kind, e)}
        onKeyDown={onHandleKey(kind)}
        style={{ left: pct(value) }}
        className={cn(
          'absolute inset-y-0 z-20 flex w-4 cursor-ew-resize touch-none items-center justify-center rounded-md bg-accent text-accent-fg shadow-md outline-offset-2',
          kind === 'start' ? '-translate-x-full rounded-r-none' : 'rounded-l-none',
        )}
      >
        <span aria-hidden className="h-6 w-0.5 rounded-full bg-accent-fg/80" />
      </div>
    );
  };

  return (
    <div className="select-none">
      <div
        ref={trackRef}
        onPointerDown={(e) => beginDrag('seek', e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative mx-4 h-16 cursor-pointer touch-none"
      >
        {/* Frames, or a plain bar when this browser cannot show the video. */}
        <div className="absolute inset-0 flex overflow-hidden rounded-lg border border-border bg-surface-3">
          {thumbs.map((src, i) => (
            <img key={i} src={src} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
          ))}
        </div>
        {/* Dim what is cut away. */}
        <div className="absolute inset-y-0 left-0 rounded-l-lg bg-bg/75" style={{ width: pct(range.start) }} />
        <div className="absolute inset-y-0 right-0 rounded-r-lg bg-bg/75" style={{ left: pct(range.end) }} />
        <div
          className="pointer-events-none absolute inset-y-0 z-10 border-y-[3px] border-accent"
          style={{ left: pct(range.start), right: `calc(100% - ${pct(range.end)})` }}
        />
        {cuts.map((t, i) => (
          <div key={t} className="pointer-events-none absolute inset-y-0 z-10" style={{ left: pct(t) }}>
            <div className="h-full border-l-2 border-dashed border-white/90 mix-blend-difference" />
            <span className="absolute -top-5 -translate-x-1/2 rounded bg-accent px-1 font-mono text-[10px] font-semibold text-accent-fg">
              {i + 2}
            </span>
          </div>
        ))}
        {handle('start')}
        {handle('end')}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-y-1.5 z-30 w-0.5 -translate-x-1/2 rounded-full bg-fg shadow"
          style={{ left: pct(currentTime) }}
        />
      </div>
      <div className="mx-4 mt-2 flex justify-between font-mono text-[11px] text-subtle tabular-nums">
        <span>{formatClock(0)}</span>
        <span>{formatClock(duration)}</span>
      </div>
    </div>
  );
}
