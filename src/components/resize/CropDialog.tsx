import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { FULL_CROP, centeredCrop, cropFits, outputSize } from '../../features/resize/resizeJob';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import { useResizeQueueStore } from '../../store/queueStore';
import { useResizeSettingsStore } from '../../store/resizeSettingsStore';
import { useUiStore } from '../../store/uiStore';
import type { QueueItem } from '../../types/media';
import type { CropRect } from '../../types/resize';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Edge = 'n' | 's' | 'e' | 'w';
type Handle = Corner | Edge;

/** Smallest crop, as a fraction of the image width. */
const MIN_WIDTH = 0.05;
/** Smallest freehand crop on either side, as a fraction of that side. */
const MIN_SIDE = 0.03;

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

/** Places a round handle on a corner, or a pill on the middle of an edge. */
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

interface Drag {
  kind: 'move' | Handle;
  startX: number;
  startY: number;
  start: CropRect;
  /** Size of the displayed image in CSS pixels. */
  boxWidth: number;
  boxHeight: number;
}

/**
 * Resizes from a corner while the opposite corner stays put. `k` converts a crop width into the
 * height that keeps the output aspect: both are fractions of different image sides.
 */
function resizeFromCorner(start: CropRect, corner: Corner, dx: number, dy: number, k: number): CropRect {
  const east = corner === 'ne' || corner === 'se';
  const south = corner === 'sw' || corner === 'se';
  const anchorX = east ? start.x : start.x + start.width;
  const anchorY = south ? start.y : start.y + start.height;
  const availableWidth = east ? 1 - anchorX : anchorX;
  const availableHeight = south ? 1 - anchorY : anchorY;
  // Follow whichever axis the pointer moved further along.
  const byX = (east ? 1 : -1) * dx;
  const byY = ((south ? 1 : -1) * dy) / k;
  const delta = Math.abs(byX) >= Math.abs(byY) ? byX : byY;
  const width = clamp(start.width + delta, Math.min(MIN_WIDTH, availableWidth), Math.min(availableWidth, availableHeight / k));
  const height = width * k;
  return { x: east ? anchorX : anchorX - width, y: south ? anchorY : anchorY - height, width, height };
}

/** Freehand: each dragged side moves on its own, so any rectangle can be drawn. */
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

function CropEditor({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const url = useObjectUrl(item.file);
  const settings = useResizeSettingsStore();
  const updateItem = useResizeQueueStore((s) => s.updateItem);
  const size = outputSize(settings);
  // Null when freehand: the crop can take any shape.
  const aspect = size ? size.width / size.height : null;
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(cropFits(item.crop, aspect) ? item.crop.rect : null);
  const drag = useRef<Drag | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const k = natural && aspect ? natural.width / natural.height / aspect : 1;
  const current = rect ?? (natural ? (aspect ? centeredCrop(natural.width, natural.height, aspect) : FULL_CROP) : null);

  // The crop box and each corner handle carry data-drag with what dragging them does.
  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (!current || !boxRef.current) return;
    const kind = e.currentTarget.dataset.drag as Drag['kind'];
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const box = boxRef.current.getBoundingClientRect();
    drag.current = { kind, startX: e.clientX, startY: e.clientY, start: current, boxWidth: box.width, boxHeight: box.height };
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
    } else if (aspect === null) {
      setRect(resizeFree(d.start, d.kind, dx, dy));
    } else {
      setRect(resizeFromCorner(d.start, d.kind as Corner, dx, dy, k));
    }
  };

  const end = () => {
    drag.current = null;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!current) return;
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
      setRect({ ...current, x: clamp(current.x + mx, 0, 1 - current.width), y: clamp(current.y + my, 0, 1 - current.height) });
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault();
      // Grow or shrink around the center.
      const factor = e.key === '-' ? 0.95 : 1.05;
      const cx = current.x + current.width / 2;
      const cy = current.y + current.height / 2;
      const maxW = 2 * Math.min(cx, 1 - cx);
      const maxH = 2 * Math.min(cy, 1 - cy);
      if (aspect === null) {
        const width = clamp(current.width * factor, MIN_SIDE, maxW);
        const height = clamp(current.height * factor, MIN_SIDE, maxH);
        setRect({ x: cx - width / 2, y: cy - height / 2, width, height });
        return;
      }
      const width = clamp(current.width * factor, MIN_WIDTH, Math.min(1, 1 / k, maxW, maxH / k));
      const height = width * k;
      setRect({ x: cx - width / 2, y: cy - height / 2, width, height });
    }
  };

  const save = () => {
    if (!current) return;
    updateItem(item.id, {
      crop: { rect: current, aspect },
      // A finished photo is resized again with its new crop.
      ...(item.status === 'completed' || item.status === 'failed' || item.status === 'cancelled'
        ? { status: 'waiting' as const, error: null }
        : {}),
    });
    onClose();
  };

  const pct = (n: number) => `${n * 100}%`;
  const cropPixels =
    current && natural ? `${Math.round(current.width * natural.width)} × ${Math.round(current.height * natural.height)}` : null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Crop photo"
      description={item.name}
      footer={
        <>
          <Button variant="ghost" onClick={() => setRect(null)} className="mr-auto" disabled={!natural}>
            {aspect === null ? 'Whole photo' : 'Center'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!current}>
            Save crop
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div
          ref={boxRef}
          className="relative mx-auto w-full touch-none select-none"
          style={
            natural
              ? { aspectRatio: `${natural.width} / ${natural.height}`, maxWidth: `calc(55dvh * ${natural.width / natural.height})` }
              : { aspectRatio: '4 / 3' }
          }
        >
          {/* The photo and the dimming are clipped to the frame; the crop box above is not, so its handles stay whole at the edges. */}
          <div className="checkerboard absolute inset-0 overflow-hidden rounded-xl border border-border">
            {url && (
              <img
                src={url}
                alt=""
                draggable={false}
                onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                className="absolute inset-0 h-full w-full object-contain"
              />
            )}
            {current && (
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: pct(current.x),
                  top: pct(current.y),
                  width: pct(current.width),
                  height: pct(current.height),
                  boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
                }}
              />
            )}
          </div>
          {current && (
            <div
              role="slider"
              tabIndex={0}
              aria-label={`${aspect === null ? 'Freehand crop area' : 'Crop area'}. Arrow keys move it, plus and minus resize it.`}
              aria-valuetext={cropPixels ? `${cropPixels} pixels of the original` : undefined}
              data-drag="move"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={end}
              onPointerCancel={end}
              onKeyDown={onKey}
              className="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                left: pct(current.x),
                top: pct(current.y),
                width: pct(current.width),
                height: pct(current.height),
                border: '1.5px solid white',
              }}
            >
              {/* Rule of thirds guides. */}
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
              </div>
              {/* Freehand adds edge handles, so one side can move without the others. */}
              {[...CORNERS, ...(aspect === null ? EDGES : [])].map((handle) => (
                <span
                  key={handle}
                  aria-hidden
                  data-drag={handle}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className="absolute h-5 w-5 rounded-full border-2 border-white bg-accent shadow"
                  style={handleStyle(handle)}
                />
              ))}
            </div>
          )}
        </div>
        <p className="tabular text-center text-xs text-muted">
          {size
            ? `Output ${size.width} × ${size.height} px${cropPixels ? ` · from ${cropPixels} px of the original` : ''}`
            : `Freehand · output ${cropPixels ?? '…'} px, at full resolution`}
        </p>
      </div>
    </Modal>
  );
}

export function CropDialog() {
  const id = useUiStore((s) => s.croppingFileId);
  const close = useUiStore((s) => s.closeCrop);
  const item = useResizeQueueStore((s) => (id ? s.items[id] : undefined));
  if (!item) return null;
  // Keyed by id so the draft crop resets for each photo.
  return <CropEditor key={item.id} item={item} onClose={close} />;
}
