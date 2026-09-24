import { MoveHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import { useObjectUrl } from '../../hooks/useObjectUrl';

interface ImageCompareProps {
  original: Blob;
  compressedUrl: string;
  width?: number;
  height?: number;
  /** What the processed image is, for its alt text. */
  resultLabel?: string;
}

/** Before/after slider. A native range input drives it, so it works with keyboard and screen readers. */
export function ImageCompare({ original, compressedUrl, width, height, resultLabel = 'Compressed version' }: ImageCompareProps) {
  const originalUrl = useObjectUrl(original);
  const [position, setPosition] = useState(50);
  const id = useId();
  const ratio = width && height ? `${width} / ${height}` : '4 / 3';

  return (
    <div>
      <div
        className="checkerboard relative mx-auto max-h-[60vh] w-full overflow-hidden rounded-xl border border-border select-none"
        style={{ aspectRatio: ratio, maxWidth: width && height ? `calc(60vh * ${width / height})` : undefined }}
      >
        <img src={compressedUrl} alt={resultLabel} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        {originalUrl && (
          <img
            src={originalUrl}
            alt="Original version"
            className="absolute inset-0 h-full w-full object-contain"
            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
            draggable={false}
          />
        )}
        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${position}%` }} aria-hidden>
          <div className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)]" />
          <div className="absolute top-1/2 -ml-4 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white text-neutral-800 shadow-lg">
            <MoveHorizontal className="h-4 w-4" />
          </div>
        </div>
        <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
          Original
        </span>
        <span className="pointer-events-none absolute top-2 right-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
          Compressed
        </span>
        <label htmlFor={id} className="sr-only">
          Comparison position: left shows the original, right shows the compressed image
        </label>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
      <p className="mt-2 text-center text-xs text-muted">Drag the slider or use the arrow keys to compare.</p>
    </div>
  );
}
