import { Music } from 'lucide-react';
import { useState } from 'react';
import type { CompressionResult } from '../../types/media';
import { formatBytes } from '../../utils/format';

/** Preview of a converted file whose type differs from the source: an animated GIF or extracted audio. */
export function ConvertedPreview({ result }: { result: CompressionResult }) {
  const [unplayable, setUnplayable] = useState(false);
  const caption = (
    <figcaption className="mt-2 flex items-center justify-between text-xs">
      <span className="font-medium text-fg">{result.fileName}</span>
      <span className="tabular text-muted">{formatBytes(result.size)}</span>
    </figcaption>
  );

  if (result.mime.startsWith('audio/')) {
    return (
      <figure>
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/50 p-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
            <Music className="h-5 w-5" aria-hidden />
          </span>
          {unplayable ? (
            <p className="text-xs text-muted">Your browser can't play this format, but the file is fine to download.</p>
          ) : (
            <audio src={result.url} controls preload="metadata" className="w-full min-w-0" onError={() => setUnplayable(true)} />
          )}
        </div>
        {caption}
      </figure>
    );
  }

  return (
    <figure>
      <div className="checkerboard mx-auto flex max-h-[60vh] items-center justify-center overflow-hidden rounded-xl border border-border">
        <img src={result.url} alt="Converted result" className="max-h-[60vh] w-auto max-w-full object-contain" draggable={false} />
      </div>
      {caption}
    </figure>
  );
}
