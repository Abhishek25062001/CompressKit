import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronDown, Download, RotateCw, SlidersHorizontal, Square, X } from 'lucide-react';
import { memo, useState } from 'react';
import { useTool } from '../../features/tools';
import { useUiStore } from '../../store/uiStore';
import { cn } from '../../utils/cn';
import { formatBytes, formatDimensions, formatDuration, formatPercent, savedRatio } from '../../utils/format';
import { Button } from '../common/Button';
import { ProgressBar } from '../common/ProgressBar';
import { ResultPanel } from '../results/ResultPanel';
import { FileThumb } from './FileThumb';
import { StatusBadge } from './StatusBadge';

function FileCardImpl({ id }: { id: string }) {
  const { useQueue, manager, downloadItem, mode, verb } = useTool();
  const item = useQueue((s) => s.items[id]);
  const openSettings = useUiStore((s) => s.openFileSettings);
  const [expanded, setExpanded] = useState(false);
  if (!item) return null;

  const { status, result } = item;
  const busy = status === 'compressing';
  const ratio = result ? savedRatio(item.size, result.size) : 0;
  const details = [
    item.typeLabel,
    formatBytes(item.size),
    item.meta.width ? formatDimensions(item.meta.width, item.meta.height) : null,
    item.kind === 'video' && item.meta.duration ? formatDuration(item.meta.duration) : null,
  ].filter(Boolean);
  const panelId = `result-${id}`;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className={cn('card overflow-hidden', status === 'completed' && 'border-accent/30')}
    >
      <div className="flex flex-wrap items-start gap-3 p-3 sm:flex-nowrap sm:items-center sm:gap-4 sm:p-4">
        <FileThumb url={item.thumbUrl} kind={item.kind} name={item.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-fg" title={item.name}>
              {item.name}
            </p>
            {item.override && (
              <span className="shrink-0 rounded bg-surface-3 px-1.5 py-px text-[10px] font-medium text-muted">Custom</span>
            )}
          </div>
          <p className="tabular mt-0.5 truncate text-xs text-muted">{details.join(' · ')}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={status} activeLabel={verb.ing} />
            {result && status === 'completed' && mode === 'convert' && (
              <span className="tabular text-xs text-muted">
                {item.typeLabel} → <span className="font-medium text-fg">{result.formatLabel}</span>
                <span className="ml-1.5">{formatBytes(result.size)}</span>
              </span>
            )}
            {result && status === 'completed' && mode === 'compress' && (
              <span className="tabular text-xs text-muted">
                {formatBytes(item.size)} → <span className="font-medium text-fg">{formatBytes(result.size)}</span>
                {ratio > 0 ? (
                  <span className="ml-1.5 font-semibold text-accent-text">{formatPercent(ratio)} smaller</span>
                ) : (
                  <span className="ml-1.5 text-muted">{result.keptOriginal ? 'already optimal' : 'no savings'}</span>
                )}
              </span>
            )}
          </div>
        </div>
        <div className="flex w-full shrink-0 items-center justify-end gap-1 border-t border-border pt-2 sm:w-auto sm:border-0 sm:pt-0">
          {status === 'completed' && result && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-expanded={expanded}
                aria-controls={panelId}
                aria-label={expanded ? 'Hide details' : 'Show details and preview'}
                onClick={() => setExpanded((v) => !v)}
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden />
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => downloadItem(id)}
                icon={<Download className="h-3.5 w-3.5" aria-hidden />}
                aria-label={`Download ${result.fileName}`}
              >
                Download
              </Button>
            </>
          )}
          {(status === 'failed' || status === 'cancelled') && item.error?.code !== 'FILE_TOO_LARGE' && (
            <Button variant="ghost" size="icon" aria-label={`Retry ${item.name}`} onClick={() => manager.retry(id)}>
              <RotateCw className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {!busy && mode === 'compress' && (
            <Button variant="ghost" size="icon" aria-label={`Settings for ${item.name}`} onClick={() => openSettings(id)}>
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
            </Button>
          )}
          {busy ? (
            <Button variant="ghost" size="icon" aria-label={`Cancel ${item.name}`} onClick={() => manager.cancel(id)}>
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" aria-label={`Remove ${item.name}`} onClick={() => manager.remove(id)}>
              <X className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {busy && (
        <div className="border-t border-border px-4 py-3" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-muted">{item.stage ?? 'Processing media...'}</span>
            <span className="tabular shrink-0 font-mono text-fg">
              {item.progress !== null ? `${Math.round(item.progress * 100)}%` : 'Processing media...'}
            </span>
          </div>
          <ProgressBar value={item.progress} label={`${verb.ing} ${item.name}`} />
        </div>
      )}

      {item.error && (status === 'failed' || status === 'cancelled') && (
        <div role={status === 'failed' ? 'alert' : undefined} className="border-t border-border px-4 py-3">
          <p className={cn('text-sm font-medium', status === 'failed' ? 'text-danger' : 'text-fg')}>{item.error.title}</p>
          <p className="mt-0.5 text-xs text-muted">{item.error.message}</p>
        </div>
      )}

      {item.warning && status === 'waiting' && (
        <p className="flex items-center gap-2 border-t border-border bg-warning-soft/60 px-4 py-2 text-xs text-warning">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {item.warning}
        </p>
      )}

      <AnimatePresence initial={false}>
        {expanded && result && status === 'completed' && (
          <motion.div
            id={panelId}
            key="result"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4">
              <ResultPanel item={item} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export const FileCard = memo(FileCardImpl);
