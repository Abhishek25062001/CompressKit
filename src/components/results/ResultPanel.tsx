import type { QueueItem } from '../../types/media';
import { engineLabel } from '../../features/compression/CompressionManager';
import { useTool } from '../../features/tools';
import { KIND_LABEL } from '../../features/clean/summary';
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

  if (mode === 'clean') return <CleanResult item={item} />;
  if (mode === 'background') {
    return (
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Output size" value={formatDimensions(result.width, result.height)} strong />
          <Stat label="Format" value={result.formatLabel} />
          <Stat label="File size" value={formatBytes(result.size)} />
          <Stat label="Time" value={formatElapsed(result.elapsedMs)} />
        </dl>
        {result.notes.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-xs text-muted">
            {result.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {/* A cropped cut-out no longer lines up with the photo, so it is shown on its own. */}
        {result.width === item.meta.width && result.height === item.meta.height ? (
          <ImageCompare original={item.file} compressedUrl={result.url} width={result.width} height={result.height} resultLabel="Cut-out" />
        ) : (
          <ConvertedPreview result={result} />
        )}
      </div>
    );
  }

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

/** Clean tool: every detail that was taken out, then the clean copy. */
function CleanResult({ item }: { item: QueueItem }) {
  const result = item.result!;
  const removed = result.removed ?? [];
  // Chrome and Firefox cannot show HEIC; the clean copy is still fine to download.
  const previewable = item.kind === 'video' || !/hei[cf]/.test(result.mime);
  return (
    <div className="space-y-4">
      {removed.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Hidden information removed from {item.name}</caption>
            <thead className="bg-surface-2/60 text-[11px] tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Removed</th>
                <th scope="col" className="px-3 py-2 font-medium">What it said</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {removed.map((r) => (
                <tr key={`${r.label}${r.value}`}>
                  <th scope="row" className="px-3 py-2 align-top font-medium whitespace-nowrap text-fg">
                    {r.label}
                    {!r.label.startsWith(KIND_LABEL[r.kind]) && (
                      <span className="block text-[10px] font-normal text-subtle">{KIND_LABEL[r.kind]}</span>
                    )}
                  </th>
                  <td className={r.kind === 'location' ? 'px-3 py-2 font-mono break-all text-warning' : 'px-3 py-2 font-mono break-all text-muted'}>
                    {r.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Details removed" value={String(removed.length)} strong />
        <Stat label="Original" value={formatBytes(item.size)} />
        <Stat label="Clean copy" value={formatBytes(result.size)} />
        <Stat label="Time" value={formatElapsed(result.elapsedMs)} />
      </dl>
      {result.notes.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-xs text-muted">
          {result.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {previewable &&
        (item.kind === 'video' ? (
          <video src={result.url} controls playsInline preload="metadata" className="mx-auto max-h-[60vh] w-full rounded-xl bg-black" />
        ) : (
          <ConvertedPreview result={result} />
        ))}
    </div>
  );
}
