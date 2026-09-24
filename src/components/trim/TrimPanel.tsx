import { RotateCcw, Scissors, SplitSquareHorizontal, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { splitRange } from '../../features/trim/parts';
import { formatLength } from '../../features/trim/time';
import { cancelTrim, startTrim } from '../../features/trim/trimJob';
import { useTrimStore } from '../../store/trimStore';
import type { VideoResolution } from '../../types/settings';
import type { CutMethod, TrimMode } from '../../types/trim';
import { Button } from '../common/Button';
import { ProgressBar } from '../common/ProgressBar';
import { SegmentedControl } from '../common/SegmentedControl';
import { Select, type SelectOption } from '../common/Select';
import { Switch } from '../common/Switch';

const PART_LENGTHS: SelectOption<number>[] = [
  { value: 60, label: '60 seconds · WhatsApp Status' },
  { value: 90, label: '90 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 10, label: '10 seconds' },
];

const RESOLUTIONS: SelectOption<VideoResolution>[] = [
  { value: 'original', label: 'Original size' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p · smaller files' },
  { value: 480, label: '480p' },
];

const METHOD_HINT: Record<CutMethod, string> = {
  fast: 'No quality loss and very quick. Cuts land on the nearest key frame, so a clip can start a moment early and parts can be slightly shorter.',
  precise: 'Cuts on the exact frame. The video is re-encoded to MP4, which takes longer.',
};

export function TrimPanel() {
  const { settings, update, reset, range, status, progress, stage, error } = useTrimStore(
    useShallow((s) => ({
      settings: s.settings,
      update: s.updateSettings,
      reset: s.resetSettings,
      range: s.range,
      status: s.status,
      progress: s.progress,
      stage: s.stage,
      error: s.error,
    })),
  );
  const running = status === 'running';
  const split = settings.mode === 'split';
  const parts = split ? splitRange(range, settings.partSeconds) : [range];
  const action = split ? `Split into ${parts.length} part${parts.length === 1 ? '' : 's'}` : 'Trim video';

  return (
    <section aria-labelledby="trim-settings-title" className="card p-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 id="trim-settings-title" className="text-sm font-semibold text-fg">
          Trim settings
        </h2>
        <Button variant="ghost" size="sm" onClick={reset} disabled={running} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
          Reset
        </Button>
      </div>

      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-muted uppercase">Mode</span>
          <SegmentedControl<TrimMode>
            label="Mode"
            size="sm"
            value={settings.mode}
            onChange={(mode) => update({ mode })}
            segments={[
              { value: 'trim', label: <><Scissors className="h-3.5 w-3.5" aria-hidden /> Trim</> },
              { value: 'split', label: <><SplitSquareHorizontal className="h-3.5 w-3.5" aria-hidden /> Split for Status</> },
            ]}
          />
        </div>

        {split && (
          <Select
            label="Longest part"
            value={settings.partSeconds}
            options={PART_LENGTHS}
            onChange={(partSeconds) => update({ partSeconds })}
            hint="A WhatsApp Status video can be up to 60 seconds. Post the parts in order and they play back to back."
          />
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Cut</span>
            <SegmentedControl<CutMethod>
              label="Cut"
              size="sm"
              value={settings.method}
              onChange={(method) => update({ method })}
              segments={[
                { value: 'fast', label: 'Fast' },
                { value: 'precise', label: 'Exact' },
              ]}
            />
          </div>
          <p className="text-xs text-muted">{METHOD_HINT[settings.method]}</p>
        </div>

        {settings.method === 'precise' && (
          <Select label="Resolution" value={settings.resolution} options={RESOLUTIONS} onChange={(resolution) => update({ resolution })} />
        )}

        <Switch
          label="Keep sound"
          checked={settings.keepAudio}
          onChange={(keepAudio) => update({ keepAudio })}
          description="Turn off for silent clips."
        />

        {split && parts.length > 1 && (
          <ol className="flex flex-wrap gap-1.5" aria-label="Planned parts">
            {parts.map((p, i) => (
              <li key={p.start} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
                {i + 1}: {formatLength(p.end - p.start)}
              </li>
            ))}
          </ol>
        )}

        <div className="border-t border-border pt-5" aria-live="polite">
          {running ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-fg">{stage ?? 'Working'}…</p>
                <Button variant="ghost" size="sm" onClick={cancelTrim} icon={<X className="h-3.5 w-3.5" aria-hidden />}>
                  Cancel
                </Button>
              </div>
              <ProgressBar value={progress} label={stage ?? 'Working'} />
            </div>
          ) : (
            <>
              {error && (
                <div role="alert" className="mb-3 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-xs">
                  <p className="font-semibold text-danger">{error.title}</p>
                  <p className="mt-0.5 text-muted">{error.message}</p>
                </div>
              )}
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={startTrim}
                icon={split ? <SplitSquareHorizontal className="h-4 w-4" aria-hidden /> : <Scissors className="h-4 w-4" aria-hidden />}
              >
                {action}
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
