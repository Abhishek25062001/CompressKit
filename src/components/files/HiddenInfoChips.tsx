import { Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { KIND_LABEL, describeKinds, kindsOf } from '../../features/clean/summary';
import type { QueueItem } from '../../types/media';

/** Clean tool: what a file hides before it is cleaned, and what was taken out afterwards. */
export function HiddenInfoChips({ item }: { item: QueueItem }) {
  const removed = item.status === 'completed' ? item.result?.removed : undefined;
  if (removed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-accent-text" aria-hidden />
        {removed.length ? (
          <>
            Removed <span className="font-medium text-fg">{describeKinds(removed)}</span>
          </>
        ) : (
          'Nothing hidden, file unchanged'
        )}
      </span>
    );
  }
  if (item.status === 'failed' || item.status === 'cancelled') return null;
  if (item.hidden === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking for hidden info…
      </span>
    );
  }
  if (item.hidden.length === 0) return <span className="text-xs text-muted">No hidden info found</span>;

  const location = item.hidden.find((f) => f.kind === 'location');
  return (
    <>
      {location && (
        <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-warning-soft px-1.5 py-px text-[11px] font-medium text-warning">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">Location: {location.value}</span>
        </span>
      )}
      {kindsOf(item.hidden)
        .filter((k) => k !== 'location')
        .map((kind) => (
          <span key={kind} className="rounded-md bg-surface-3 px-1.5 py-px text-[11px] font-medium text-muted">
            {KIND_LABEL[kind]}
          </span>
        ))}
    </>
  );
}
