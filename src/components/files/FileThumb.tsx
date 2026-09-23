import { Film, Image as ImageIcon } from 'lucide-react';
import type { MediaKind } from '../../types/media';

export function FileThumb({ url, kind, name }: { url: string | null; kind: MediaKind; name: string }) {
  return (
    <div className="checkerboard relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border sm:h-16 sm:w-16">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-surface-2 text-muted" aria-hidden>
          {kind === 'video' ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
        </div>
      )}
      {kind === 'video' && url && (
        <span className="absolute right-1 bottom-1 rounded bg-black/60 p-0.5 text-white" aria-hidden>
          <Film className="h-2.5 w-2.5" />
        </span>
      )}
      <span className="sr-only">{`${kind} preview of ${name}`}</span>
    </div>
  );
}
