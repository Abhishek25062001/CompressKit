import { ChevronLeft, ChevronRight, Maximize, ScanSearch } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { usePagePreview } from '../../hooks/usePagePreview';
import { getOpenPdf } from '../../features/pdf/documents';
import { clampCrop, detectMargins, FULL, fromDisplayed, isCropped, toDisplayed } from '../../features/pdf/crop';
import { refreshThumbnail } from '../../features/pdf/intake';
import { usePdfSettingsStore, usePdfStore } from '../../store/pdfStore';
import type { CropBox, PdfPage } from '../../types/pdf';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

type Handle = 'move' | 'new' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface Drag {
  handle: Handle;
  startX: number;
  startY: number;
  start: CropBox;
  boxWidth: number;
  boxHeight: number;
  /** Where a new box was started, as fractions of the page. */
  originX: number;
  originY: number;
}

const HANDLES: { handle: Handle; className: string; cursor: string }[] = [
  { handle: 'nw', className: '-top-1.5 -left-1.5', cursor: 'nwse-resize' },
  { handle: 'n', className: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { handle: 'ne', className: '-top-1.5 -right-1.5', cursor: 'nesw-resize' },
  { handle: 'e', className: 'top-1/2 -right-1.5 -translate-y-1/2', cursor: 'ew-resize' },
  { handle: 'se', className: '-right-1.5 -bottom-1.5', cursor: 'nwse-resize' },
  { handle: 's', className: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'ns-resize' },
  { handle: 'sw', className: '-bottom-1.5 -left-1.5', cursor: 'nesw-resize' },
  { handle: 'w', className: 'top-1/2 -left-1.5 -translate-y-1/2', cursor: 'ew-resize' },
];

/** Resizes a box by dragging one of its edges or corners by (dx, dy), in fractions of the page. */
function resize(start: CropBox, handle: Handle, dx: number, dy: number): CropBox {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = Math.min(right - 0.02, Math.max(0, left + dx));
  if (handle.includes('e')) right = Math.max(left + 0.02, Math.min(1, right + dx));
  if (handle.includes('n')) top = Math.min(bottom - 0.02, Math.max(0, top + dy));
  if (handle.includes('s')) bottom = Math.max(top + 0.02, Math.min(1, bottom + dy));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The page's size as displayed, in points (photos: pixels), for the size readout. */
function usePageSize(page: PdfPage): { width: number; height: number; unit: 'pt' | 'px' } | null {
  const [size, setSize] = useState<{ width: number; height: number; unit: 'pt' | 'px' } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const source = usePdfStore.getState().sources[page.sourceId];
    if (source?.kind !== 'pdf') return;
    void (async () => {
      const pdfPage = await getOpenPdf(source.id).view.getPage(page.index + 1);
      const viewport = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + page.rotation) % 360 });
      if (!cancelled) setSize({ width: viewport.width, height: viewport.height, unit: 'pt' });
    })();
    return () => {
      cancelled = true;
    };
  }, [page.sourceId, page.index, page.rotation]);
  return size;
}

function describeSize(size: { width: number; height: number; unit: 'pt' | 'px' }, box: CropBox): string {
  const w = size.width * box.width;
  const h = size.height * box.height;
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  const inch = (pt: number) => (pt / 72).toFixed(2);
  return `${mm(w)} × ${mm(h)} mm (${inch(w)} × ${inch(h)} in)`;
}

function Cropper({ page, position, total, onNavigate, onClose }: { page: PdfPage; position: number; total: number; onNavigate: (delta: number) => void; onClose: () => void }) {
  const preview = usePagePreview(page);
  const size = usePageSize(page);
  const [box, setBox] = useState<CropBox>(() => toDisplayed(page.crop ?? FULL, page.rotation));
  const [detecting, setDetecting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const begin = (e: PointerEvent<HTMLElement>, handle: Handle) => {
    if (!frameRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = frameRef.current.getBoundingClientRect();
    drag.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      start: box,
      boxWidth: rect.width,
      boxHeight: rect.height,
      originX: (e.clientX - rect.left) / rect.width,
      originY: (e.clientY - rect.top) / rect.height,
    };
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.boxWidth;
    const dy = (e.clientY - d.startY) / d.boxHeight;
    if (d.handle === 'move') {
      setBox(clampCrop({ ...d.start, x: d.start.x + dx, y: d.start.y + dy }));
    } else if (d.handle === 'new') {
      // Dragging on the page outside the box draws a new one from that point.
      const x2 = Math.min(1, Math.max(0, d.originX + dx));
      const y2 = Math.min(1, Math.max(0, d.originY + dy));
      const left = Math.min(d.originX, x2);
      const top = Math.min(d.originY, y2);
      if (Math.abs(x2 - d.originX) > 0.01 && Math.abs(y2 - d.originY) > 0.01) {
        setBox({ x: left, y: top, width: Math.max(0.02, Math.abs(x2 - d.originX)), height: Math.max(0.02, Math.abs(y2 - d.originY)) });
      }
    } else {
      setBox(resize(d.start, d.handle, dx, dy));
    }
  };
  const onUp = () => {
    drag.current = null;
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    // Alt resizes from the bottom-right corner; otherwise the box moves.
    setBox((b) => (e.altKey ? resize(b, 'se', move[0], move[1]) : clampCrop({ ...b, x: b.x + move[0], y: b.y + move[1] })));
  };

  const detect = async () => {
    const source = usePdfStore.getState().sources[page.sourceId];
    if (!source) return;
    setDetecting(true);
    setNotFound(false);
    try {
      const found = await detectMargins(page, source, usePdfSettingsStore.getState().cropPadding);
      if (found) setBox(toDisplayed(found, page.rotation));
      else setNotFound(true);
    } finally {
      setDetecting(false);
    }
  };

  const cropOf = (b: CropBox) => {
    const frame = clampCrop(fromDisplayed(b, page.rotation));
    return isCropped(frame) ? frame : undefined;
  };
  const save = (ids: string[]) => {
    const crop = cropOf(box);
    const { updatePage } = usePdfStore.getState();
    for (const id of ids) {
      updatePage(id, { crop });
      refreshThumbnail(id);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Crop page ${position + 1}`}
      description="Drag the box or its handles, or draw a new one on the page."
      footer={
        <>
          <div className="mr-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => onNavigate(-1)} disabled={position === 0} aria-label="Previous page" title="Previous page">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => onNavigate(1)} disabled={position === total - 1} aria-label="Next page" title="Next page">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              save(usePdfStore.getState().pages.map((p) => p.id));
              onClose();
            }}
          >
            Apply to all pages
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              save([page.id]);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void detect()} disabled={detecting || !preview} icon={<ScanSearch className="h-3.5 w-3.5" aria-hidden />}>
          {detecting ? 'Finding margins…' : 'Remove white margins'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setBox(FULL)} icon={<Maximize className="h-3.5 w-3.5" aria-hidden />}>
          Whole page
        </Button>
        <span className="ml-auto text-xs text-muted tabular" aria-live="polite">
          {notFound ? 'This page looks blank.' : size ? describeSize(size, box) : `${Math.round(box.width * 100)}% × ${Math.round(box.height * 100)}% of the photo`}
        </span>
      </div>
      <div
        ref={frameRef}
        onPointerDown={(e) => begin(e, 'new')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative mx-auto w-full cursor-crosshair touch-none overflow-hidden rounded-xl border border-border bg-white select-none"
        style={
          preview
            ? { aspectRatio: `${preview.width} / ${preview.height}`, maxWidth: `calc(56dvh * ${preview.width / preview.height})` }
            : { aspectRatio: '3 / 4', maxWidth: 'calc(56dvh * 0.75)' }
        }
      >
        {preview ? (
          <img src={preview.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading page…</p>
        )}
        {preview && (
          <>
            <div
              role="group"
              tabIndex={0}
              aria-label="Crop box. Arrow keys move it; Alt with arrow keys resizes it."
              onPointerDown={(e) => begin(e, 'move')}
              onKeyDown={onKey}
              className="absolute cursor-move outline-2 outline-accent outline-solid focus-visible:outline-4"
              // The shadow darkens everything outside the box: the part that will be cut off.
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
                boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
              }}
            >
              {HANDLES.map(({ handle, className, cursor }) => (
                <span
                  key={handle}
                  aria-hidden
                  onPointerDown={(e) => begin(e, handle)}
                  className={`absolute h-3 w-3 rounded-full border-2 border-white bg-accent shadow ${className}`}
                  style={{ cursor }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        {page.crop ? 'This page is cropped. Use Whole page, then Save, to undo it.' : 'Apply to all pages uses the same area on every page.'}
      </p>
    </Modal>
  );
}

/** Opens for the page chosen in the Crop tab, and moves between pages without closing. */
export function CropDialog() {
  const pageId = usePdfStore((s) => s.croppingPageId);
  const pages = usePdfStore((s) => s.pages);
  const position = pages.findIndex((p) => p.id === pageId);
  const page = position >= 0 ? pages[position] : undefined;
  const { setCroppingPage } = usePdfStore.getState();
  if (!page) return null;
  return (
    <Cropper
      key={page.id}
      page={page}
      position={position}
      total={pages.length}
      onNavigate={(delta) => setCroppingPage(pages[position + delta]?.id ?? page.id)}
      onClose={() => setCroppingPage(null)}
    />
  );
}
