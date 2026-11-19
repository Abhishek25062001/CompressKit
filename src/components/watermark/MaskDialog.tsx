import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_WATERMARK_MASK } from '../../features/watermark/maskRect';
import { useWatermarkQueueStore } from '../../store/queueStore';
import { useUiStore } from '../../store/uiStore';
import type { QueueItem } from '../../types/media';
import type { CropRect } from '../../types/resize';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Edge = 'n' | 's' | 'e' | 'w';
type Handle = Corner | Edge;

const MIN_SIDE = 0.02;
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];
const EDGES: Edge[] = ['n', 's', 'e', 'w'];

const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

function handleStyle(handle: Handle): CSSProperties {
  const style: CSSProperties = { cursor: CURSOR[handle] };
  if (handle.includes('n')) style.top = -10;
  if (handle.includes('s')) style.bottom = -10;
  if (handle.includes('w')) style.left = -10;
  if (handle.includes('e')) style.right = -10;
  if (handle === 'n' || handle === 's') {
    style.left = 'calc(50% - 14px)';
    style.width = 28;
    style.height = 20;
  }
  if (handle === 'e' || handle === 'w') {
    style.top = 'calc(50% - 14px)';
    style.width = 20;
    style.height = 28;
  }
  return style;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function resizeFree(start: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - MIN_SIDE);
  if (handle.includes('e')) right = clamp(right + dx, left + MIN_SIDE, 1);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SIDE);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIDE, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

interface Drag {
  kind: 'move' | Handle;
  startX: number;
  startY: number;
  start: CropRect;
  boxWidth: number;
  boxHeight: number;
}

/**
 * Oriented preview that matches removeWatermark: createImageBitmap(..., from-image) so fraction
 * coords are relative to EXIF-oriented natural width/height, not a raw unoriented JPEG layout.
 */
function useOrientedPreview(file: File): { url: string | null; width: number; height: number } | null {
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        if (cancelled) {
          bitmap.close();
          return;
        }
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext('2d');
        if (!ctx) {
          bitmap.close();
          return;
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ url: objectUrl, width: c.width, height: c.height });
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return preview;
}

function MaskEditor({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const oriented = useOrientedPreview(item.file);
  const updateItem = useWatermarkQueueStore((s) => s.updateItem);
  // Prefer the user's saved mark; only seed the editor with the default when they have none yet.
  const [rect, setRect] = useState<CropRect>(() => item.crop?.rect ?? DEFAULT_WATERMARK_MASK);
  const drag = useRef<Drag | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (!boxRef.current) return;
    const kind = e.currentTarget.dataset.drag as Drag['kind'];
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const box = boxRef.current.getBoundingClientRect();
    drag.current = { kind, startX: e.clientX, startY: e.clientY, start: rect, boxWidth: box.width, boxHeight: box.height };
  };

  const onMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.boxWidth;
    const dy = (e.clientY - d.startY) / d.boxHeight;
    if (d.kind === 'move') {
      setRect({
        ...d.start,
        x: clamp(d.start.x + dx, 0, 1 - d.start.width),
        y: clamp(d.start.y + dy, 0, 1 - d.start.height),
      });
    } else {
      setRect(resizeFree(d.start, d.kind, dx, dy));
    }
  };

  const end = () => {
    drag.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [mx, my] = moves[e.key];
      setRect((r) => ({ ...r, x: clamp(r.x + mx, 0, 1 - r.width), y: clamp(r.y + my, 0, 1 - r.height) }));
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      const factor = e.key === '-' ? 0.95 : 1.05;
      setRect((r) => {
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const width = clamp(r.width * factor, MIN_SIDE, 2 * Math.min(cx, 1 - cx));
        const height = clamp(r.height * factor, MIN_SIDE, 2 * Math.min(cy, 1 - cy));
        return { x: cx - width / 2, y: cy - height / 2, width, height };
      });
    }
  };

  const save = () => {
    updateItem(item.id, {
      crop: { rect, aspect: null, rotate: 0, mirror: false },
      ...(item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled'
        ? { status: 'waiting' as const, error: null }
        : {}),
    });
    onClose();
  };

  const pct = (n: number) => `${n * 100}%`;
  const markPixels =
    oriented != null
      ? `${Math.round(rect.width * oriented.width)} × ${Math.round(rect.height * oriented.height)}`
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Mark the watermark"
      description={item.name}
      size="wide"
      footer={
        <>
          <Button variant="ghost" onClick={() => setRect(DEFAULT_WATERMARK_MASK)} className="mr-auto" disabled={!oriented}>
            Bottom right
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!oriented}>
            Save mark
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Drag the box over the logo or text you want removed. Cover it tightly; a little margin is fine. The preview
          uses the same EXIF orientation as processing.
        </p>
        <div
          ref={boxRef}
          className="relative mx-auto w-full touch-none select-none"
          style={
            oriented
              ? { aspectRatio: `${oriented.width} / ${oriented.height}`, maxWidth: `calc(55dvh * ${oriented.width / oriented.height})` }
              : { aspectRatio: '4 / 3' }
          }
        >
          <div className="absolute inset-0 overflow-hidden rounded-xl border border-border bg-surface-2">
            {oriented?.url && (
              <img src={oriented.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" />
            )}
          </div>
          <div
            role="slider"
            tabIndex={0}
            aria-label="Watermark area. Arrow keys move it, plus and minus resize it."
            aria-valuetext={markPixels ? `${markPixels} pixels` : undefined}
            data-drag="move"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={onKey}
            className="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              left: pct(rect.x),
              top: pct(rect.y),
              width: pct(rect.width),
              height: pct(rect.height),
              border: '1.5px solid white',
              boxShadow: '0 0 0 9999px rgb(220 38 38 / 0.35)',
              background: 'rgb(220 38 38 / 0.15)',
            }}
          >
            {[...CORNERS, ...EDGES].map((handle) => (
              <span
                key={handle}
                aria-hidden
                data-drag={handle}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={end}
                onPointerCancel={end}
                className="absolute h-5 w-5 rounded-full border-2 border-white bg-danger shadow"
                style={handleStyle(handle)}
              />
            ))}
          </div>
        </div>
        <p className="tabular text-center text-xs text-muted">
          Marked area {markPixels ?? '…'} px
          {oriented ? ` of oriented ${oriented.width} × ${oriented.height}` : ''} · expand + glow grow when removing
        </p>
      </div>
    </Modal>
  );
}

export function MaskDialog() {
  const id = useUiStore((s) => s.maskingFileId);
  const close = useUiStore((s) => s.closeMask);
  const item = useWatermarkQueueStore((s) => (id ? s.items[id] : undefined));
  if (!item) return null;
  return <MaskEditor key={item.id} item={item} onClose={close} />;
}
