import type { QueueItem } from '../../types/media';
import { engineLabel } from '../../features/compression/CompressionManager';
import { useTool } from '../../features/tools';
import { formatBytes, formatDimensions, formatDuration, formatElapsed, formatPercent, savedRatio } from '../../utils/format';
import { ConvertedPreview } from '../preview/ConvertedPreview';
import { ImageCompare } from '../preview/ImageCompare';
import { VideoCompare } from '../preview/VideoCompare';

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/50 px-3 py-2.5">
      <dt className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className={strong ? 'tabular mt-0.5 font-mono text-sm font-semibold text-accent-text' : 'tabular mt-0.5 font-mono text-sm text-fg'}>
        {value}
      </dd>
    </div>
  );
}

export function ResultPanel({ item }: { item: QueueItem }) {
  const { mode } = useTool();
  const result = item.result;
  if (!result) return null;
  const ratio = savedRatio(item.size, result.size);
  const saved = item.size - result.size;
  const outputKind = result.mime.startsWith('image/') ? 'image' : result.mime.startsWith('video/') ? 'video' : 'other';

  return (
    <div className="space-y-4">
      {mode === 'resize' ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Original size" value={formatDimensions(item.meta.width, item.meta.height)} />
          <Stat label="Output size" value={formatDimensions(result.width, result.height)} strong />
          <Stat label="Original" value={formatBytes(item.size)} />
          <Stat label="Resized" value={formatBytes(result.size)} />
          <Stat label="Format" value={result.formatLabel} />
          <Stat label="Time" value={formatElapsed(result.elapsedMs)} />
        </dl>
      ) : mode === 'convert' ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="From" value={item.typeLabel} />
          <Stat label="To" value={result.formatLabel} strong />
          <Stat label="Original" value={formatBytes(item.size)} />
          <Stat label="Converted" value={formatBytes(result.size)} />
          {outputKind !== 'other' && <Stat label="Original size" value={formatDimensions(item.meta.width, item.meta.height)} />}
          {outputKind !== 'other' && <Stat label="Output size" value={formatDimensions(result.width, result.height)} />}
          {item.kind === 'video' && outputKind !== 'image' && (
            <Stat label="Duration" value={formatDuration(result.duration ?? item.meta.duration)} />
          )}
          <Stat label="Time" value={formatElapsed(result.elapsedMs)} />
          <Stat label="Engine" value={engineLabel(result.engine)} />
        </dl>
      ) : (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Original" value={formatBytes(item.size)} />
          <Stat label="Compressed" value={formatBytes(result.size)} />
          <Stat label="Saved" value={saved > 0 ? formatBytes(saved) : '0 B'} />
          <Stat label="Smaller by" value={ratio > 0 ? formatPercent(ratio) : '0%'} strong />
          <Stat label="Original size" value={formatDimensions(item.meta.width, item.meta.height)} />
          <Stat label="Output size" value={formatDimensions(result.width, result.height)} />
          <Stat label="Format" value={result.formatLabel} />
          <Stat label="Time" value={formatElapsed(result.elapsedMs)} />
          {item.kind === 'video' && <Stat label="Duration" value={formatDuration(result.duration ?? item.meta.duration)} />}
          <Stat label="Engine" value={engineLabel(result.engine)} />
        </dl>
      )}
      {result.notes.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-xs text-muted">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {item.kind !== outputKind || mode === 'resize' ? (
        <ConvertedPreview result={result} />
      ) : item.kind === 'image' ? (
        <ImageCompare original={item.file} compressedUrl={result.url} width={result.width} height={result.height} />
      ) : (
        <VideoCompare
          original={item.file}
          originalSize={item.size}
          originalDuration={item.meta.duration}
          compressedUrl={result.url}
          compressedSize={result.size}
          compressedDuration={result.duration}
        />
      )}
    </div>
  );
}
