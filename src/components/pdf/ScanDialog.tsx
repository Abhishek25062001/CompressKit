import { Maximize, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../../features/image/canvas';
import { decodeImage } from '../../features/image/decode';
import { refreshThumbnail } from '../../features/pdf/intake';
import { FULL_PHOTO, SCAN_FILTERS, applyScan, detectPageCorners } from '../../features/pdf/scan';
import { usePdfStore } from '../../store/pdfStore';
import type { PdfPage, ScanFilter } from '../../types/pdf';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { SegmentedControl } from '../common/SegmentedControl';

type Corners = [number, number][];

const LABELS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const PHOTO_SIDE = 1400;
const PREVIEW_SIDE = 800;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

async function toUrl(canvas: ReturnType<typeof createCanvas>, type = 'image/jpeg'): Promise<string> {
  const blob = await canvasToBlob(canvas, type, 0.88);
  return URL.createObjectURL(blob);
}

function Editor({ page, onClose }: { page: PdfPage; onClose: () => void }) {
  const source = usePdfStore((s) => s.sources[page.sourceId]);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [corners, setCorners] = useState<Corners | null>(page.scan?.corners ?? null);
  const [filter, setFilter] = useState<ScanFilter>(page.scan?.filter ?? 'none');
  const [note, setNote] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  // Decode the photo once, show a screen-sized copy, and suggest page edges for a photo not yet edited.
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    let decoded: ImageBitmap | null = null;
    void (async () => {
      decoded = await decodeImage(source.file);
      if (cancelled) return decoded.close();
      const k = Math.min(1, PHOTO_SIDE / Math.max(decoded.width, decoded.height));
      const shown = createCanvas(Math.round(decoded.width * k), Math.round(decoded.height * k));
      getContext(shown).drawImage(decoded, 0, 0, shown.width, shown.height);
      url = await toUrl(shown);
      releaseCanvas(shown);
      if (cancelled) return;
      setBitmap(decoded);
      setPhotoUrl(url);
      if (!page.scan) {
        const found = detectPageCorners(decoded);
        setCorners(found);
        setNote(found ? 'Page edges found. Drag the corners to adjust.' : 'No clear page edges found. Drag the corners onto the page.');
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      decoded?.close();
    };
  }, [source.file, page.scan]);

  // Live preview of the straightened, cleaned page, redrawn shortly after each change.
  useEffect(() => {
    if (!bitmap) return;
    let url: string | null = null;
    const timer = setTimeout(async () => {
      const result = applyScan(bitmap, { corners, filter }, PREVIEW_SIDE);
      url = await toUrl(result);
      releaseCanvas(result);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [bitmap, corners, filter]);

  const shown = corners ?? FULL_PHOTO;

  const onDown = (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = Number(e.currentTarget.dataset.corner);
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const i = dragging.current;
    const box = boxRef.current?.getBoundingClientRect();
    if (i === null || !box) return;
    const next = shown.map((p) => [...p]) as Corners;
    next[i] = [clamp01((e.clientX - box.left) / box.width), clamp01((e.clientY - box.top) / box.height)];
    setCorners(next);
  };
  const onUp = () => {
    dragging.current = null;
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, i: number) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const next = shown.map((p) => [...p]) as Corners;
    next[i] = [clamp01(next[i][0] + m[0]), clamp01(next[i][1] + m[1])];
    setCorners(next);
  };

  const detect = () => {
    if (!bitmap) return;
    const found = detectPageCorners(bitmap);
    if (found) setCorners(found);
    setNote(found ? 'Page edges found. Drag the corners to adjust.' : 'No clear page edges found. Drag the corners onto the page.');
  };

  const save = () => {
    const isFull = !corners || corners.every(([x, y], i) => Math.abs(x - FULL_PHOTO[i][0]) < 0.002 && Math.abs(y - FULL_PHOTO[i][1]) < 0.002);
    const scan = isFull && filter === 'none' ? undefined : { corners: isFull ? null : corners, filter };
    usePdfStore.getState().updatePage(page.id, { scan });
    refreshThumbnail(page.id);
    onClose();
  };

  const points = shown.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');

  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title="Scan cleanup"
      description="Straighten the page and choose how it looks."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!bitmap}>
            Apply
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <figure className="min-w-0">
            <div
              ref={boxRef}
              className="relative mx-auto w-full touch-none select-none"
              style={bitmap ? { aspectRatio: `${bitmap.width} / ${bitmap.height}`, maxWidth: `calc(50dvh * ${bitmap.width / bitmap.height})` } : { aspectRatio: '3 / 4' }}
            >
              <div className="checkerboard absolute inset-0 overflow-hidden rounded-xl border border-border">
                {photoUrl && <img src={photoUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full" />}
                {photoUrl && (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
                    <path d={`M0 0H100V100H0Z M${points.replace(/ /g, ' L')}Z`} fill="rgb(0 0 0 / 0.45)" fillRule="evenodd" />
                    <polygon points={points} fill="none" stroke="var(--accent)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
              </div>
              {photoUrl &&
                shown.map(([x, y], i) => (
                  <span
                    key={LABELS[i]}
                    role="slider"
                    tabIndex={0}
                    aria-label={`Page ${LABELS[i]} corner. Arrow keys move it.`}
                    aria-valuetext={`${Math.round(x * 100)}% across, ${Math.round(y * 100)}% down`}
                    data-corner={i}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                    onKeyDown={(e) => onKey(e, i)}
                    className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-accent shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                  />
                ))}
              {!photoUrl && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading photo…</p>}
            </div>
            <figcaption className="mt-2 text-center text-xs text-muted">{note ?? 'Drag the corners onto the page.'}</figcaption>
          </figure>
          <figure className="min-w-0">
            <div className="checkerboard flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border border-border bg-white">
              {previewUrl ? (
                <img src={previewUrl} alt="Preview of the cleaned page" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-sm text-muted">Preparing preview…</span>
              )}
            </div>
            <figcaption className="mt-2 text-center text-xs text-muted">Result</figcaption>
          </figure>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button size="sm" onClick={detect} disabled={!bitmap} icon={<ScanSearch className="h-3.5 w-3.5" aria-hidden />}>
              Find page edges
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCorners(null)} icon={<Maximize className="h-3.5 w-3.5" aria-hidden />}>
              Whole photo
            </Button>
          </div>
          <SegmentedControl label="Look" size="sm" value={filter} onChange={setFilter} segments={SCAN_FILTERS} />
        </div>
      </div>
    </Modal>
  );
}

export function ScanDialog() {
  const id = usePdfStore((s) => s.scanningPageId);
  const page = usePdfStore((s) => s.pages.find((p) => p.id === id));
  const close = () => usePdfStore.getState().setScanningPage(null);
  if (!page) return null;
  return <Editor key={page.id} page={page} onClose={close} />;
}
