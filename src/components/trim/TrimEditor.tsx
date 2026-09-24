import { Pause, Play, Trash2, VideoOff } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { splitRange } from '../../features/trim/parts';
import { formatClock, formatLength, parseClock } from '../../features/trim/time';
import { MIN_CLIP_SECONDS, clearTrim } from '../../features/trim/trimJob';
import { useTrimStore } from '../../store/trimStore';
import { formatBytes, formatDimensions } from '../../utils/format';
import { Button } from '../common/Button';
import { Timeline } from './Timeline';

interface TimeFieldProps {
  label: string;
  value: number;
  onCommit: (seconds: number) => void;
  onUsePlayhead: () => void;
  disabled?: boolean;
}

/** Typed time with tenths, plus a button that takes the player's position. */
function TimeField({ label, value, onCommit, onUsePlayhead, disabled }: TimeFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const seconds = parseClock(draft);
    if (seconds !== null) onCommit(seconds);
    setDraft(null);
  };
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </label>
      <div className="flex gap-1.5">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={draft ?? formatClock(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
          aria-describedby={`${id}-hint`}
          className="tabular h-10 w-full min-w-0 rounded-xl border border-border bg-surface px-3 font-mono text-sm text-fg hover:border-border-strong focus-visible:border-accent"
        />
        <Button variant="secondary" size="md" className="px-3" onClick={onUsePlayhead} disabled={disabled} title={`Set ${label.toLowerCase()} to the current frame`}>
          Here
        </Button>
      </div>
      <span id={`${id}-hint`} className="sr-only">
        Minutes and seconds, for example 1:05.5
      </span>
    </div>
  );
}

export function TrimEditor() {
  const { source, range, setRange, mode, partSeconds, running } = useTrimStore(
    useShallow((s) => ({
      source: s.source!,
      range: s.range,
      setRange: s.setRange,
      mode: s.settings.mode,
      partSeconds: s.settings.partSeconds,
      running: s.status === 'running',
    })),
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  /** Set while "Play selection" runs, so playback stops at the end of the clip. */
  const stopAt = useRef<number | null>(null);

  const { duration } = source;
  const length = range.end - range.start;
  const cuts = useMemo(
    () => (mode === 'split' ? splitRange(range, partSeconds).slice(1).map((p) => p.start) : []),
    [mode, range, partSeconds],
  );

  // Follow playback smoothly; timeupdate alone fires only a few times per second.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        setCurrentTime(video.currentTime);
        if (stopAt.current !== null && video.currentTime >= stopAt.current) {
          video.pause();
          stopAt.current = null;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seek = (t: number) => {
    setCurrentTime(t);
    const video = videoRef.current;
    if (video && source.playable) video.currentTime = t;
  };

  const togglePlaySelection = () => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      return;
    }
    const inside = video.currentTime >= range.start && video.currentTime < range.end - 0.05;
    if (!inside) video.currentTime = range.start;
    stopAt.current = range.end;
    void video.play();
  };

  const setStart = (t: number) => setRange({ start: Math.max(0, Math.min(t, range.end - MIN_CLIP_SECONDS)), end: range.end });
  const setEnd = (t: number) => setRange({ start: range.start, end: Math.max(Math.min(duration, t), range.start + MIN_CLIP_SECONDS) });
  const playhead = () => videoRef.current?.currentTime ?? currentTime;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg" title={source.name}>
            {source.name}
          </p>
          <p className="text-xs text-muted">
            {formatClock(duration)} · {formatBytes(source.file.size)}
            {source.width ? ` · ${formatDimensions(source.width, source.height)}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={clearTrim} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
          Remove
        </Button>
      </div>

      <div className="bg-black">
        {source.playable ? (
          <video
            ref={videoRef}
            src={source.url}
            controls
            playsInline
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false);
              stopAt.current = null;
            }}
            onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onTimeUpdate={(e) => !playing && setCurrentTime(e.currentTarget.currentTime)}
            className="mx-auto block max-h-[52vh] w-full"
          />
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/70">
            <VideoOff className="h-8 w-8" aria-hidden />
            <p>This browser cannot preview this video, but it can still cut it. Set the times below.</p>
          </div>
        )}
      </div>

      <div className="space-y-5 p-4 pt-7">
        <Timeline
          url={source.url}
          duration={duration}
          playable={source.playable}
          range={range}
          onRangeChange={setRange}
          currentTime={currentTime}
          onSeek={seek}
          cuts={cuts}
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <TimeField label="Start" value={range.start} onCommit={setStart} onUsePlayhead={() => setStart(playhead())} disabled={!source.playable} />
          <TimeField label="End" value={range.end} onCommit={setEnd} onUsePlayhead={() => setEnd(playhead())} disabled={!source.playable} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            Keeping <span className="font-semibold text-fg tabular-nums">{formatLength(length)}</span>
            {length < duration - 0.05 && <> of {formatLength(duration)}</>}
            {cuts.length > 0 && (
              <>
                {' '}in <span className="font-semibold text-fg">{cuts.length + 1} parts</span>
              </>
            )}
          </p>
          <div className="flex gap-2">
            {(range.start > 0 || range.end < duration) && (
              <Button variant="ghost" size="sm" onClick={() => setRange({ start: 0, end: duration })} disabled={running}>
                Select all
              </Button>
            )}
            {source.playable && (
              <Button
                variant="secondary"
                size="sm"
                onClick={togglePlaySelection}
                icon={playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              >
                {playing ? 'Pause' : 'Play selection'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
