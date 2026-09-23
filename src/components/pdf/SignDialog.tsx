import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { canvasToBlob, releaseCanvas } from '../../features/image/canvas';
import { decodeImage } from '../../features/image/decode';
import { getOpenPdf } from '../../features/pdf/documents';
import { renderPage } from '../../features/pdf/render';
import { usePdfStore } from '../../store/pdfStore';
import type { PdfPage, SignatureAsset, SignaturePlacement } from '../../types/pdf';
import { createId } from '../../utils/id';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { SignatureMaker } from './SignatureMaker';

/** Long side of the page preview, in pixels. */
const PREVIEW_SIDE = 1100;
const MIN_WIDTH = 0.06;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

interface Drag {
  id: string;
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  start: SignaturePlacement;
  boxWidth: number;
  boxHeight: number;
}

/** The page as displayed (with the user's rotation), as an object URL and its size. */
function usePagePreview(page: PdfPage) {
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void (async () => {
      const source = usePdfStore.getState().sources[page.sourceId];
      if (!source) return;
      // renderPage scales PDF pages per point and photos per pixel, so size each from its own dimensions.
      let longSide: number;
      if (source.kind === 'pdf') {
        const viewport = (await getOpenPdf(source.id).view.getPage(page.index + 1)).getViewport({ scale: 1 });
        longSide = Math.max(viewport.width, viewport.height);
      } else {
        const bitmap = await decodeImage(source.file);
        longSide = Math.max(bitmap.width, bitmap.height);
        bitmap.close();
      }
      const canvas = await renderPage(page, source, Math.min(4, PREVIEW_SIDE / longSide), page.rotation, '#ffffff', page.scan);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
      const size = { width: canvas.width, height: canvas.height };
      releaseCanvas(canvas);
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setPreview({ url, ...size });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [page]);
  return preview;
}

function Placer({ page, signature, onClose }: { page: PdfPage; signature: SignatureAsset; onClose: () => void }) {
  const preview = usePagePreview(page);
  const [placements, setPlacements] = useState<SignaturePlacement[]>(() =>
    page.signatures.length ? page.signatures : [{ id: createId(), x: 0.6, y: 0.78, width: 0.3 }],
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  // Height of a placement as a fraction of page height: it follows the signature's shape.
  const heightOf = (width: number) =>
    preview ? (width * preview.width * signature.height) / signature.width / preview.height : width * 0.3;

  const update = (id: string, next: SignaturePlacement) => setPlacements((list) => list.map((p) => (p.id === id ? next : p)));
  const fit = (p: SignaturePlacement): SignaturePlacement => {
    const width = clamp(p.width, MIN_WIDTH, 1);
    return { ...p, width, x: clamp(p.x, 0, 1 - width), y: clamp(p.y, 0, Math.max(0, 1 - heightOf(width))) };
  };

  const onDown = (e: PointerEvent<HTMLElement>) => {
    const id = e.currentTarget.dataset.id;
    const kind = e.currentTarget.dataset.drag as Drag['kind'];
    const start = placements.find((p) => p.id === id);
    if (!start || !id || !boxRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = boxRef.current.getBoundingClientRect();
    drag.current = { id, kind, startX: e.clientX, startY: e.clientY, start, boxWidth: box.width, boxHeight: box.height };
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.boxWidth;
    const dy = (e.clientY - d.startY) / d.boxHeight;
    update(d.id, fit(d.kind === 'move' ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, width: d.start.width + dx }));
  };
  const onUp = () => {
    drag.current = null;
  };
  const onKey = (e: KeyboardEvent<HTMLElement>, p: SignaturePlacement) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, Partial<SignaturePlacement>> = {
      ArrowLeft: { x: p.x - step },
      ArrowRight: { x: p.x + step },
      ArrowUp: { y: p.y - step },
      ArrowDown: { y: p.y + step },
      '+': { width: p.width * 1.05 },
      '=': { width: p.width * 1.05 },
      '-': { width: p.width * 0.95 },
    };
    if (moves[e.key]) {
      e.preventDefault();
      update(p.id, fit({ ...p, ...moves[e.key] }));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setPlacements((list) => list.filter((x) => x.id !== p.id));
    }
  };

  const save = () => {
    usePdfStore.getState().updatePage(page.id, { signatures: placements.map(fit) });
    onClose();
  };
  /** Same spot on every page, as fractions of each page, so it lands in the same corner on all of them. */
  const saveToAll = () => {
    const { pages, applySignatures } = usePdfStore.getState();
    applySignatures(
      pages.map((p) => p.id),
      placements.map(fit),
    );
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Place signature"
      description="Drag to move. Drag the corner to resize."
      footer={
        <>
          <Button
            variant="ghost"
            className="mr-auto"
            onClick={() => setPlacements((list) => [...list, fit({ id: createId(), x: 0.35, y: 0.45, width: 0.3 })])}
            icon={<Plus className="h-4 w-4" aria-hidden />}
          >
            Add another
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          {placements.length > 0 && <Button onClick={saveToAll}>Apply to all pages</Button>}
          <Button variant="primary" onClick={save}>
            {placements.length ? 'Save' : 'Remove signatures'}
          </Button>
        </>
      }
    >
      <div
        ref={boxRef}
        className="relative mx-auto w-full touch-none overflow-hidden rounded-xl border border-border bg-white select-none"
        style={
          preview
            ? { aspectRatio: `${preview.width} / ${preview.height}`, maxWidth: `calc(58dvh * ${preview.width / preview.height})` }
            : { aspectRatio: '3 / 4', maxWidth: 'calc(58dvh * 0.75)' }
        }
      >
        {preview ? (
          <img src={preview.url} alt="" draggable={false} className="absolute inset-0 h-full w-full" />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">Loading page…</p>
        )}
        {preview &&
          placements.map((p) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              aria-label="Signature. Arrow keys move it, plus and minus resize it, Delete removes it."
              data-id={p.id}
              data-drag="move"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={(e) => onKey(e, p)}
              className="group absolute cursor-move rounded-sm outline-1 outline-accent outline-dashed focus-visible:outline-2 focus-visible:outline-solid"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.width * 100}%` }}
            >
              <img src={signature.url} alt="" draggable={false} className="block h-auto w-full" />
              <button
                type="button"
                aria-label="Remove this signature"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setPlacements((list) => list.filter((x) => x.id !== p.id))}
                className="absolute -top-2.5 -right-2.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white shadow"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
              <span
                aria-hidden
                data-id={p.id}
                data-drag="resize"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                className="absolute -right-2 -bottom-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-accent shadow"
              />
            </div>
          ))}
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        {placements.length === 0 ? 'No signature on this page. Use Add another to place one.' : 'Your signature is kept only in this tab and is never saved.'}
      </p>
    </Modal>
  );
}

/** Opens for the page whose ✎ button was pressed. Without a signature yet, it asks for one first. */
export function SignDialog() {
  const pageId = usePdfStore((s) => s.signingPageId);
  const page = usePdfStore((s) => s.pages.find((p) => p.id === pageId));
  const signature = usePdfStore((s) => s.signature);
  const close = () => usePdfStore.getState().setSigningPage(null);
  if (!page) return null;
  if (!signature) {
    return (
      <Modal open onClose={close} title="Create your signature" description="Then place it on the page.">
        <SignatureMaker />
      </Modal>
    );
  }
  return <Placer key={page.id} page={page} signature={signature} onClose={close} />;
}
