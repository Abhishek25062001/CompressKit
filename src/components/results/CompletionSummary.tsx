import { motion, useReducedMotion } from 'framer-motion';
import { Download, Loader2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { compressionManager } from '../../features/compression/CompressionManager';
import { downloadAll } from '../../features/compression/downloads';
import { useQueueSummary } from '../../hooks/useQueueSummary';
import { useUiStore } from '../../store/uiStore';
import { formatBytes, formatPercent, savedRatio } from '../../utils/format';
import { Button } from '../common/Button';

function SuccessMark() {
  const reduce = useReducedMotion();
  return (
    <motion.svg
      viewBox="0 0 52 52"
      className="h-14 w-14"
      aria-hidden
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
    >
      <circle cx="26" cy="26" r="25" fill="var(--accent-soft)" />
      <circle cx="26" cy="26" r="18" fill="var(--accent)" />
      <motion.path
        d="M18 26.5 23.5 32 34 21"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay: 0.2, duration: 0.45, ease: 'easeOut' }}
      />
    </motion.svg>
  );
}

export function CompletionSummary() {
  const summary = useQueueSummary();
  const pushNotice = useUiStore((s) => s.pushNotice);
  const [zipProgress, setZipProgress] = useState<number | null>(null);
  const ratio = savedRatio(summary.completedOriginalBytes, summary.completedBytes);

  const onDownloadAll = async () => {
    setZipProgress(0);
    try {
      await downloadAll((r) => setZipProgress(r));
    } catch {
      pushNotice({ tone: 'error', title: "We couldn't create the ZIP", message: 'Try downloading files individually.' });
    } finally {
      setZipProgress(null);
    }
  };

  const compressMore = () => {
    compressionManager.clear();
    document.getElementById('compress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <motion.section
      aria-labelledby="complete-title"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="card relative overflow-hidden p-6 text-center sm:p-8"
    >
      <div
        className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-2/3 rounded-full opacity-70 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--accent-soft), transparent)' }}
        aria-hidden
      />
      <div className="relative flex flex-col items-center">
        <SuccessMark />
        <h2 id="complete-title" className="mt-4 text-2xl font-semibold tracking-tight text-fg">
          Compression complete
        </h2>
        <p className="mt-1 text-sm text-muted">Your files are ready.</p>
        <p className="tabular mt-3 font-mono text-sm text-fg">
          {formatBytes(summary.completedOriginalBytes)} → {formatBytes(summary.completedBytes)}
        </p>

        <div className="mt-6 grid w-full max-w-lg grid-cols-3 gap-2">
          <div className="rounded-xl border border-border bg-surface-2/50 px-3 py-3">
            <p className="tabular font-mono text-lg font-semibold text-fg">{summary.completed}</p>
            <p className="text-[11px] text-muted">{summary.completed === 1 ? 'file compressed' : 'files compressed'}</p>
          </div>
          <div className="rounded-xl border border-border bg-surface-2/50 px-3 py-3">
            <p className="tabular font-mono text-lg font-semibold whitespace-nowrap text-fg">{formatBytes(summary.completedBytes)}</p>
            <p className="text-[11px] text-muted">
              from <span className="tabular whitespace-nowrap">{formatBytes(summary.completedOriginalBytes)}</span>
            </p>
          </div>
          <div className="rounded-xl border border-accent/40 bg-accent-soft/60 px-3 py-3">
            <p className="tabular font-mono text-lg font-semibold text-accent-text">{ratio > 0 ? formatPercent(ratio) : '0%'}</p>
            <p className="text-[11px] text-muted">smaller</p>
          </div>
        </div>
        {summary.failed > 0 && (
          <p className="mt-3 text-xs text-danger">
            {summary.failed} file{summary.failed === 1 ? '' : 's'} could not be compressed. See the details below.
          </p>
        )}

        <div className="mt-6 flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
          <Button
            variant="primary"
            size="lg"
            onClick={onDownloadAll}
            disabled={zipProgress !== null}
            icon={zipProgress !== null ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          >
            {zipProgress !== null
              ? `Preparing ZIP ${Math.round(zipProgress * 100)}%`
              : summary.completed > 1
                ? 'Download All (.zip)'
                : 'Download'}
          </Button>
          <Button size="lg" onClick={compressMore} icon={<RefreshCw className="h-4 w-4" aria-hidden />}>
            Compress More
          </Button>
        </div>
      </div>
    </motion.section>
  );
}
