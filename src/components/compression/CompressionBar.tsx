import { Loader2, Play, Square, Trash2 } from 'lucide-react';
import { compressionManager } from '../../features/compression/CompressionManager';
import { useQueueSummary } from '../../hooks/useQueueSummary';
import { useQueueStore, selectRunning } from '../../store/queueStore';
import { formatBytes } from '../../utils/format';
import { Button } from '../common/Button';

export function CompressionBar() {
  const summary = useQueueSummary();
  const running = useQueueStore(selectRunning);
  const pending = summary.waiting;
  const active = summary.compressing;

  const parts = [
    summary.images ? `${summary.images} image${summary.images === 1 ? '' : 's'}` : null,
    summary.videos ? `${summary.videos} video${summary.videos === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0" aria-live="polite">
        <p className="text-sm font-semibold text-fg">
          {running ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-accent-text" aria-hidden />
              Compressing… {summary.completed} of {summary.completed + pending + active} done
            </span>
          ) : (
            `${summary.total} file${summary.total === 1 ? '' : 's'} selected`
          )}
        </p>
        <p className="tabular text-xs text-muted">
          {parts.join(' · ')} · {formatBytes(summary.originalBytes)} total
        </p>
      </div>
      <div className="flex items-center gap-2">
        {running ? (
          <Button onClick={() => compressionManager.cancelAll()} icon={<Square className="h-3.5 w-3.5 fill-current" aria-hidden />}>
            Cancel all
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => compressionManager.clear()} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
            Clear
          </Button>
        )}
        <Button
          variant="primary"
          disabled={running || pending === 0}
          onClick={() => compressionManager.start()}
          icon={<Play className="h-4 w-4 fill-current" aria-hidden />}
          className="flex-1 sm:flex-none"
        >
          {pending > 0 ? `Compress ${pending} file${pending === 1 ? '' : 's'}` : 'Compress'}
        </Button>
      </div>
    </div>
  );
}
