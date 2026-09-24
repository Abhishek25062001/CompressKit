import { Camera, CalendarClock, Check, FileText, MapPin, UserRound } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { hasLocation } from '../../features/clean/summary';
import { useTool } from '../../features/tools';

const REMOVED = [
  { icon: MapPin, title: 'Location', body: 'GPS coordinates and place names' },
  { icon: Camera, title: 'Camera', body: 'Make, model, lens and serial number' },
  { icon: CalendarClock, title: 'Dates', body: 'When the photo was taken or the video recorded' },
  { icon: UserRound, title: 'Names', body: 'Owner, author, artist and copyright' },
  { icon: FileText, title: 'Everything else', body: 'Software, comments, XMP and IPTC details, and extras such as motion-photo clips' },
];

/** The clean tool has no settings: it explains what leaves the file and what stays. */
export function CleanInfoPanel() {
  const { useQueue } = useTool();
  const { total, scanned, located } = useQueue(
    useShallow((s) => {
      const items = s.order.map((id) => s.items[id]).filter(Boolean);
      return {
        total: items.length,
        scanned: items.filter((i) => i.hidden !== undefined).length,
        located: items.filter((i) => hasLocation(i.hidden)).length,
      };
    }),
  );

  return (
    <section aria-labelledby="clean-info-title" className="card p-5">
      <h2 id="clean-info-title" className="text-sm font-semibold text-fg">
        What gets removed
      </h2>
      {total > 0 && scanned === total && (
        <p
          className={
            located
              ? 'mt-3 rounded-xl border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs font-medium text-warning'
              : 'mt-3 rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-xs text-muted'
          }
          aria-live="polite"
        >
          {located
            ? `${located} of ${total} file${total === 1 ? '' : 's'} reveal${located === 1 ? 's' : ''} where ${located === 1 ? 'it was' : 'they were'} taken.`
            : `No location found in ${total === 1 ? 'this file' : `these ${total} files`}.`}
        </p>
      )}
      <ul className="mt-4 space-y-3">
        {REMOVED.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{title}</p>
              <p className="text-xs text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">Kept as it is</p>
        <ul className="mt-2 space-y-1.5 text-xs text-muted">
          {['The picture and sound, which are never re-encoded', 'Which way up the photo is shown', 'Colour profile'].map((line) => (
            <li key={line} className="flex gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-4 text-xs text-subtle">
        Email, cloud links, AirDrop and apps that send photos &ldquo;as a document&rdquo; pass this information on unchanged.
      </p>
    </section>
  );
}
