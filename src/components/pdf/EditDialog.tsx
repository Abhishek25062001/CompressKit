import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  Highlighter,
  ImagePlus,
  Info,
  Italic,
  Loader2,
  MousePointer2,
  Move,
  PenLine,
  Redo2,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { PageTextLine } from '../../features/docs/pdfExtract';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../../features/image/canvas';
import { decodeImage } from '../../features/image/decode';
import { savePdf } from '../../features/pdf/actions';
import { getOpenPdf } from '../../features/pdf/documents';
import { EDIT_CSS_FONT, EDIT_LINE_HEIGHT } from '../../features/pdf/edits';
import { useDialog } from '../../hooks/useDialog';
import { usePagePreview } from '../../hooks/usePagePreview';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PageEdit, PdfPage } from '../../types/pdf';
import { cn } from '../../utils/cn';
import { createId } from '../../utils/id';
import { Button } from '../common/Button';

type Tool = 'select' | 'replace' | 'text' | 'image' | 'draw' | 'highlight' | 'box' | 'whiteout';
type TextEdit = Extract<PageEdit, { kind: 'text' }>;
type RectEdit = Extract<PageEdit, { kind: 'whiteout' | 'highlight' | 'box' }>;

const TOOLS: { value: Tool; label: string; icon: LucideIcon; hint: string }[] = [
  { value: 'select', label: 'Select', icon: MousePointer2, hint: 'Pick a tool above, or tap a change on the page to move or restyle it.' },
  { value: 'replace', label: 'Edit text', icon: TextCursorInput, hint: 'Tap any highlighted line to retype it. New text uses a standard font.' },
  { value: 'text', label: 'Add text', icon: Type, hint: 'Tap the page where the text should go, then type.' },
  { value: 'image', label: 'Image', icon: ImagePlus, hint: 'Tap the page to pick a picture, then drag it into place.' },
  { value: 'draw', label: 'Draw', icon: PenLine, hint: 'Draw with your mouse, finger or pen.' },
  { value: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Drag over the text to highlight it.' },
  { value: 'box', label: 'Shape', icon: Square, hint: 'Drag to draw a rectangle.' },
  { value: 'whiteout', label: 'White-out', icon: Eraser, hint: 'Drag over anything you want to hide.' },
];

const COLORS = ['#000000', '#4b5563', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#ffffff'];
const HIGHLIGHTS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];
const THICKNESS = [
  { value: 0.002, label: 'Thin' },
  { value: 0.004, label: 'Medium' },
  { value: 0.008, label: 'Thick' },
];
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
const HISTORY_LIMIT = 100;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** The last-used text style and colours, kept across pages so new edits look like the previous one. */
interface EditStyle {
  size: number;
  color: string;
  font: TextEdit['font'];
  bold: boolean;
  italic: boolean;
  highlight: string;
  ink: string;
  thickness: number;
  shape: string;
}

const DEFAULT_STYLE: EditStyle = {
  size: 12,
  color: '#000000',
  font: 'sans',
  bold: false,
  italic: false,
  highlight: HIGHLIGHTS[0],
  ink: '#1d4ed8',
  thickness: 0.004,
  shape: '#dc2626',
};

type Drag =
  | { kind: 'move'; id: string; startX: number; startY: number; start: PageEdit }
  | { kind: 'resize'; id: string; startX: number; startY: number; start: PageEdit }
  | { kind: 'create'; id: string; startX: number; startY: number }
  | { kind: 'draw'; id: string };

function moveEdit(edit: PageEdit, dx: number, dy: number): PageEdit {
  if (edit.kind === 'draw') return { ...edit, strokes: edit.strokes.map((s) => s.map(([x, y]) => [x + dx, y + dy] as [number, number])) };
  return { ...edit, x: clamp(edit.x + dx, -0.05, 0.98), y: clamp(edit.y + dy, -0.05, 0.98) };
}

/** Most common colour just outside a box on the page, used to cover replaced text. */
function sampleBackground(ctx: CanvasRenderingContext2D, w: number, h: number, line: PageTextLine): string {
  const x0 = Math.floor(line.x * w) - 3;
  const x1 = Math.ceil((line.x + line.width) * w) + 3;
  const y0 = Math.floor(line.y * h) - 2;
  const y1 = Math.ceil((line.y + line.height) * h) + 2;
  const counts = new Map<string, number>();
  const add = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    // Round so JPEG noise does not split one colour into many.
    const key = [r, g, b].map((c) => Math.min(255, Math.round(c / 8) * 8).toString(16).padStart(2, '0')).join('');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (let x = x0; x <= x1; x += 2) {
    add(x, y0);
    add(x, y1);
  }
  for (let y = y0; y <= y1; y += 2) {
    add(x0, y);
    add(x1, y);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ? `#${best}` : '#ffffff';
}

/** Photos are stored as JPEG, pictures with transparency as PNG, so the PDF stays small. */
async function readPicture(file: File) {
  const bitmap = await decodeImage(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = createCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  getContext(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const png = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
  const blob = await canvasToBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.9);
  const size = { width: canvas.width, height: canvas.height };
  releaseCanvas(canvas);
  return { blob, url: URL.createObjectURL(blob), ...size };
}

function IconButton({ label, icon: Icon, active, onClick, disabled, compact, round }: {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  round?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-35',
        compact ? 'h-8 w-8' : 'h-9 w-9',
        round ? 'rounded-full' : 'rounded-lg',
        active ? 'bg-accent-soft text-accent-text ring-1 ring-accent/40' : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function Swatches({ colors, value, onChange, label }: { colors: string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-1.5">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${label} ${c}`}
          aria-pressed={value.toLowerCase() === c}
          onClick={() => onChange(c)}
          className={cn('h-6 w-6 rounded-full border border-border-strong transition-transform', value.toLowerCase() === c && 'scale-110 ring-2 ring-accent ring-offset-1 ring-offset-surface')}
          style={{ background: c }}
        />
      ))}
      <label className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border-strong text-[10px] text-muted" title="Other colour">
        +
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`${label}: other colour`} />
      </label>
    </div>
  );
}

const Divider = () => <span aria-hidden className="h-6 w-px shrink-0 bg-border" />;

interface TextLook {
  font: TextEdit['font'];
  sizePt: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align?: TextEdit['align'];
}

/** Font, size, style, alignment and colour, for the selected text box or the next one. */
function TextControls({ value, onChange }: { value: TextLook; onChange: (patch: Partial<TextLook>) => void }) {
  return (
    <>
      <select
        aria-label="Font"
        value={value.font}
        onChange={(e) => onChange({ font: e.target.value as TextEdit['font'] })}
        className="h-9 shrink-0 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
      >
        <option value="sans">Helvetica</option>
        <option value="serif">Times</option>
        <option value="mono">Courier</option>
      </select>
      <div className="flex shrink-0 items-center rounded-lg border border-border bg-surface">
        <button
          type="button"
          aria-label="Smaller text"
          onClick={() => onChange({ sizePt: clamp(value.sizePt - 1, 4, 200) })}
          className="h-9 w-8 text-muted hover:text-fg"
        >
          −
        </button>
        <input
          type="number"
          aria-label="Text size in points"
          min={4}
          max={200}
          step={0.5}
          value={value.sizePt}
          onChange={(e) => onChange({ sizePt: clamp(Number(e.target.value) || 12, 4, 200) })}
          className="tabular h-9 w-11 border-x border-border bg-transparent text-center text-sm text-fg [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label="Bigger text"
          onClick={() => onChange({ sizePt: clamp(value.sizePt + 1, 4, 200) })}
          className="h-9 w-8 text-muted hover:text-fg"
        >
          +
        </button>
      </div>
      <div className="flex shrink-0 gap-0.5">
        <IconButton label="Bold" icon={Bold} active={value.bold} onClick={() => onChange({ bold: !value.bold })} />
        <IconButton label="Italic" icon={Italic} active={value.italic} onClick={() => onChange({ italic: !value.italic })} />
      </div>
      {value.align && (
        <div className="flex shrink-0 gap-0.5">
          <IconButton label="Align left" icon={AlignLeft} active={value.align === 'left'} onClick={() => onChange({ align: 'left' })} />
          <IconButton label="Align center" icon={AlignCenter} active={value.align === 'center'} onClick={() => onChange({ align: 'center' })} />
          <IconButton label="Align right" icon={AlignRight} active={value.align === 'right'} onClick={() => onChange({ align: 'right' })} />
        </div>
      )}
      <Divider />
      <Swatches colors={COLORS.slice(0, 6)} value={value.color} label="Text colour" onChange={(color) => onChange({ color })} />
    </>
  );
}

function ThicknessPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="group" aria-label="Line width" className="flex shrink-0 gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {THICKNESS.map((t) => (
        <button
          key={t.value}
          type="button"
          aria-pressed={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn('rounded-md px-2.5 py-1 text-xs font-medium', value === t.value ? 'bg-accent-soft text-accent-text' : 'text-muted hover:text-fg')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Every page of the document, to jump between them without leaving the editor. */
function PageRail({ current, editsHere, onPick }: { current: string; editsHere: number; onPick: (id: string) => void }) {
  const pages = usePdfStore((s) => s.pages);
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <nav aria-label="Pages" className="hidden w-32 shrink-0 overflow-y-auto border-r border-border bg-surface p-3 md:block lg:w-40">
      <ol className="space-y-3">
        {pages.map((p, i) => {
          const active = p.id === current;
          const edited = active ? editsHere > 0 : !!p.edits?.length;
          return (
            <li key={p.id}>
              <button
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => !active && onPick(p.id)}
                aria-current={active ? 'page' : undefined}
                aria-label={`Page ${i + 1}${edited ? ', edited' : ''}`}
                className="group block w-full text-left"
              >
                <span
                  className={cn(
                    'relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-lg border bg-white p-1 transition-shadow',
                    active ? 'border-accent ring-2 ring-accent' : 'border-border group-hover:border-border-strong',
                  )}
                >
                  {p.thumbUrl ? (
                    <img src={p.thumbUrl} alt="" draggable={false} className="h-full w-full object-contain" style={{ transform: `rotate(${p.rotation}deg)` }} />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-hidden />
                  )}
                  {edited && (
                    <span className="absolute top-1 right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-fg" aria-hidden>
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </span>
                <span className={cn('tabular mt-1 block text-center text-xs', active ? 'font-semibold text-fg' : 'text-muted')}>{i + 1}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface EditorProps {
  page: PdfPage;
  tool: Tool;
  setTool: (tool: Tool) => void;
  style: EditStyle;
  setStyle: (update: (s: EditStyle) => EditStyle) => void;
  saveRef: RefObject<(() => void) | null>;
  onNavigate: (id: string) => void;
  onClose: () => void;
  onDownload: () => void;
}

function Editor({ page, tool, setTool, style, setStyle, saveRef, onNavigate, onClose, onDownload }: EditorProps) {
  const preview = usePagePreview(page);
  const source = usePdfStore((s) => s.sources[page.sourceId]);
  const editImages = usePdfStore((s) => s.editImages);
  const pageIds = usePdfStore((s) => s.pages.map((p) => p.id).join(','));
  const busy = usePdfStore((s) => !!s.busy);
  const order = pageIds.split(',');
  const position = order.indexOf(page.id);
  const [edits, setEdits] = useState<PageEdit[]>(() => page.edits ?? []);
  const [past, setPast] = useState<PageEdit[][]>([]);
  const [future, setFuture] = useState<PageEdit[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<PageTextLine[] | null>(null);
  const [pageHeightPt, setPageHeightPt] = useState(842);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fit, setFit] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const editsRef = useRef(edits);
  const boxRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const zoomRef = useRef(1);
  const shownRef = useRef(1);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const pinchUsed = useRef(false);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const queuedZoom = useRef<{ n: number; x: number; y: number } | null>(null);
  const zoomFrame = useRef(0);
  const settleZoom = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const sampler = useRef<{ ctx: CanvasRenderingContext2D; w: number; h: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const remember = (patch: Partial<EditStyle>) => setStyle((s) => ({ ...s, ...patch }));
  editsRef.current = edits;

  const current = edits.find((e) => e.id === selected) ?? null;

  /** Remembers the page as it is now, so the next change can be undone. */
  const checkpoint = () => {
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), editsRef.current]);
    setFuture([]);
  };
  /** Forgets the last checkpoint if nothing changed after it, such as a tap that did not drag. */
  const dropUnchanged = () => setPast((p) => (p.length && p[p.length - 1] === editsRef.current ? p.slice(0, -1) : p));
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [editsRef.current, ...f]);
    setEdits(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setSelected(null);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, editsRef.current]);
    setEdits(future[0]);
    setFuture((f) => f.slice(1));
    setSelected(null);
  };

  const update = (id: string, patch: Partial<PageEdit>) =>
    setEdits((list) => list.map((e) => (e.id === id ? ({ ...e, ...patch } as PageEdit) : e)));
  /** A change made from the toolbar: one undo step each. */
  const change = (id: string, patch: Partial<PageEdit>) => {
    checkpoint();
    update(id, patch);
  };
  const remove = (id: string) => {
    checkpoint();
    setEdits((list) => list.filter((e) => e.id !== id));
    setSelected(null);
  };

  // The page's edits go to the store when the editor closes or moves to another page.
  useEffect(() => {
    saveRef.current = () => {
      // Empty text boxes that cover nothing are dropped.
      const kept = editsRef.current.filter((e) => !(e.kind === 'text' && !e.text.trim() && !e.background));
      usePdfStore.getState().updatePage(page.id, { edits: kept });
    };
    return () => {
      saveRef.current = null;
    };
  }, [page.id, saveRef]);

  // Page size in points, to show text sizes the way people know them.
  useEffect(() => {
    if (source?.kind !== 'pdf') return;
    void getOpenPdf(source.id)
      .view.getPage(page.index + 1)
      .then((p) => setPageHeightPt(p.getViewport({ scale: 1, rotation: (p.rotate + page.rotation) % 360 }).height));
  }, [source, page.index, page.rotation]);

  // The room the page has, so it starts fitted to the screen.
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setFit({
        w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ready = fit.w > 0 && fit.h > 0;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview, zoom, ready]);

  const pageRatio = preview ? preview.width / preview.height : 0.75;
  const fitRef = useRef(fit);
  const pageRatioRef = useRef(pageRatio);
  fitRef.current = fit;
  pageRatioRef.current = pageRatio;
  const widthFor = (z: number) => `${Math.max(1, Math.min(fitRef.current.w, fitRef.current.h * pageRatioRef.current)) * z}px`;

  /** Resizes the page in place, keeping the point under (clientX, clientY). No React render. */
  const applyZoom = (next: number, clientX: number, clientY: number) => {
    const boxEl = boxRef.current;
    const view = viewRef.current;
    if (!boxEl || !view) return;
    const shown = clamp(next, ZOOM_MIN, ZOOM_MAX);
    const before = boxEl.getBoundingClientRect();
    const fx = before.width ? clamp((clientX - before.left) / before.width, 0, 1) : 0.5;
    const fy = before.height ? clamp((clientY - before.top) / before.height, 0, 1) : 0.5;
    shownRef.current = shown;
    boxEl.style.width = widthFor(shown);
    const after = boxEl.getBoundingClientRect();
    view.scrollLeft += after.left + fx * after.width - clientX;
    view.scrollTop += after.top + fy * after.height - clientY;
    if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round(shown * 100)}%`;
  };

  const queueZoom = (next: number, clientX: number, clientY: number) => {
    queuedZoom.current = { n: next, x: clientX, y: clientY };
    if (zoomFrame.current) return;
    zoomFrame.current = requestAnimationFrame(() => {
      zoomFrame.current = 0;
      const job = queuedZoom.current;
      queuedZoom.current = null;
      if (job) applyZoom(job.n, job.x, job.y);
    });
  };

  /** Writes the live size into React once the gesture is over, so the two cannot drift. */
  const commitZoom = () => {
    window.clearTimeout(settleZoom.current);
    if (zoomFrame.current) {
      cancelAnimationFrame(zoomFrame.current);
      zoomFrame.current = 0;
    }
    const job = queuedZoom.current;
    queuedZoom.current = null;
    if (job) applyZoom(job.n, job.x, job.y);
    const shown = shownRef.current;
    if (Math.abs(shown - zoomRef.current) < 0.001) return;
    zoomRef.current = shown;
    setZoom(shown);
  };

  const glideZoom = (target: number, clientX: number, clientY: number) => {
    const from = shownRef.current;
    const to = clamp(target, ZOOM_MIN, ZOOM_MAX);
    const started = performance.now();
    cancelAnimationFrame(zoomFrame.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 220);
      const eased = 1 - (1 - t) ** 3;
      applyZoom(from + (to - from) * eased, clientX, clientY);
      if (t < 1) zoomFrame.current = requestAnimationFrame(step);
      else {
        zoomFrame.current = 0;
        zoomRef.current = to;
        setZoom(to);
      }
    };
    zoomFrame.current = requestAnimationFrame(step);
  };

  const viewCenter = () => {
    const rect = viewRef.current?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 };
  };

  // Trackpad pinch zooms toward the pointer, one frame at a time, then settles.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    let target = shownRef.current;
    let tracking = false;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (!tracking) target = shownRef.current;
      tracking = true;
      target = clamp(target * Math.exp(-e.deltaY * 0.0016), ZOOM_MIN, ZOOM_MAX);
      queueZoom(target, e.clientX, e.clientY);
      window.clearTimeout(settleZoom.current);
      settleZoom.current = window.setTimeout(() => {
        tracking = false;
        commitZoom();
      }, 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** A second finger cancels a stroke that the first finger just started, and begins a pinch. */
  const armPinch = () => {
    if (pointers.current.size < 2) {
      pinchRef.current = null;
      return;
    }
    const [a, b] = [...pointers.current.values()];
    cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = 0;
    pinchUsed.current = true;
    pinchRef.current = { dist: Math.max(12, Math.hypot(a.x - b.x, a.y - b.y)), zoom: shownRef.current };
    const started = drag.current;
    if (started && (started.kind === 'create' || started.kind === 'draw')) {
      drag.current = null;
      setEdits((list) => list.filter((ed) => ed.id !== started.id));
      setSelected((id) => (id === started.id ? null : id));
      // The checkpoint taken when the stroke began belongs to nothing now.
      setPast((p) => p.slice(0, -1));
    } else {
      drag.current = null;
    }
    panRef.current = null;
  };

  // Text on the page, for "Edit text", read once when that tool is first picked.
  useEffect(() => {
    if (tool !== 'replace' || lines || source?.kind !== 'pdf') return;
    let cancelled = false;
    void (async () => {
      const [{ pageTextLines }, pdfPage] = await Promise.all([import('../../features/docs/pdfExtract'), getOpenPdf(source.id).view.getPage(page.index + 1)]);
      const found = await pageTextLines(pdfPage, page.rotation);
      if (!cancelled) setLines(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [tool, lines, source, page.index, page.rotation]);

  // The page picture, for matching the colour behind replaced text.
  useEffect(() => {
    if (!preview) return;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      sampler.current = { ctx, w: canvas.width, h: canvas.height };
    };
    img.src = preview.url;
  }, [preview]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const addText = (edit: Omit<TextEdit, 'id' | 'kind'>) => {
    const id = createId();
    checkpoint();
    setEdits((list) => [...list, { id, kind: 'text', ...edit }]);
    setSelected(id);
    setFocusId(id);
    setTool('select');
  };

  const onBoxDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) {
      armPinch();
      return;
    }
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.surface) return;
    if (tool === 'image') {
      fileRef.current?.click();
      return;
    }
    const p = point(e);
    const s = style;
    if (tool === 'text') {
      addText({
        x: clamp(p.x, 0, 0.9),
        y: clamp(p.y - (s.size / pageHeightPt) * 0.6, 0, 0.97),
        width: clamp(0.35, 0.05, 1 - p.x),
        text: '',
        size: s.size / pageHeightPt,
        color: s.color,
        bold: s.bold,
        italic: s.italic,
        font: s.font,
        align: 'left',
      });
      return;
    }
    if (tool === 'whiteout' || tool === 'highlight' || tool === 'box') {
      const id = createId();
      const color = tool === 'whiteout' ? '#ffffff' : tool === 'highlight' ? s.highlight : s.shape;
      checkpoint();
      setEdits((list) => [...list, { id, kind: tool, x: p.x, y: p.y, width: 0, height: 0, color }]);
      setSelected(id);
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'create', id, startX: p.x, startY: p.y };
      return;
    }
    if (tool === 'draw') {
      const id = createId();
      checkpoint();
      setEdits((list) => [...list, { id, kind: 'draw', strokes: [[[p.x, p.y]]], color: s.ink, thickness: s.thickness }]);
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'draw', id };
      return;
    }
    setSelected(null);
  };

  const onItemDown = (e: ReactPointerEvent<HTMLElement>, edit: PageEdit, kind: 'move' | 'resize' = 'move') => {
    if (tool === 'draw') return;
    e.stopPropagation();
    // Typing and selecting text inside the selected text box must not start a drag.
    if ((e.target as HTMLElement).tagName === 'TEXTAREA') return;
    e.preventDefault();
    setSelected(edit.id);
    if (tool !== 'select') setTool('select');
    const p = point(e);
    boxRef.current!.setPointerCapture(e.pointerId);
    checkpoint();
    drag.current = { kind, id: edit.id, startX: p.x, startY: p.y, start: edit };
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.kind === 'draw') {
      setEdits((list) =>
        list.map((ed) => (ed.id === d.id && ed.kind === 'draw' ? { ...ed, strokes: [[...ed.strokes[0], [p.x, p.y]]] } : ed)),
      );
    } else if (d.kind === 'create') {
      update(d.id, {
        x: Math.min(d.startX, p.x),
        y: Math.min(d.startY, p.y),
        width: Math.abs(p.x - d.startX),
        height: Math.abs(p.y - d.startY),
      } as Partial<RectEdit>);
    } else if (d.kind === 'move') {
      setEdits((list) => list.map((ed) => (ed.id === d.id ? moveEdit(d.start, p.x - d.startX, p.y - d.startY) : ed)));
    } else {
      const s = d.start;
      if (s.kind === 'draw') return;
      const width = clamp(s.width + p.x - d.startX, 0.02, 1.2);
      if (s.kind === 'text') update(d.id, { width });
      else if (s.kind === 'image') update(d.id, { width, height: (s.height * width) / s.width });
      else update(d.id, { width, height: clamp(s.height + p.y - d.startY, 0.005, 1.2) });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    // A click without a drag makes a sensible default box instead of an invisible one.
    if (d?.kind === 'create') {
      setEdits((list) =>
        list.map((ed) =>
          ed.id === d.id && ed.kind !== 'text' && ed.kind !== 'draw' && ed.width < 0.01 && ed.height < 0.005
            ? { ...ed, width: 0.25, height: ed.kind === 'highlight' ? 0.02 : 0.05 }
            : ed,
        ),
      );
    } else if (d?.kind === 'move' || d?.kind === 'resize') {
      dropUnchanged();
    }
  };

  const onReplace = (line: PageTextLine) => {
    const background = sampler.current ? sampleBackground(sampler.current.ctx, sampler.current.w, sampler.current.h, line) : '#ffffff';
    addText({
      // Slightly wider than the line, so the new text wraps no sooner than the old.
      x: line.x - 0.002,
      y: line.y,
      width: line.width + 0.02,
      text: line.text,
      size: line.size,
      color: background === '#000000' ? '#ffffff' : '#000000',
      bold: line.bold,
      italic: line.italic,
      font: line.font,
      align: 'left',
      background,
      coverHeight: line.height,
    });
  };

  const onPicture = async (file: File | undefined) => {
    if (!file) {
      setTool('select');
      return;
    }
    try {
      const picture = await readPicture(file);
      const id = createId();
      usePdfStore.getState().addEditImage(id, picture);
      const aspect = picture.height / picture.width;
      const width = 0.3;
      const height = preview ? (width * preview.width * aspect) / preview.height : width * aspect;
      const editId = createId();
      checkpoint();
      setEdits((list) => [...list, { id: editId, kind: 'image', x: 0.35, y: clamp(0.4 - height / 2, 0, 0.9), width, height, imageId: id }]);
      setSelected(editId);
    } catch {
      useUiStore.getState().pushNotice({ tone: 'error', title: "Couldn't open that picture", message: 'Try a JPG or PNG.' });
    }
    setTool('select');
  };

  // Shortcuts. Escape first lets go of the selection or tool; only then does it close the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = !!(e.target as HTMLElement).closest('textarea, input, select');
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape' && (selected || tool !== 'select')) {
        e.preventDefault();
        if (typing) (e.target as HTMLElement).blur();
        setSelected(null);
        setTool('select');
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (!selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(selected);
      }
      const step = e.shiftKey ? 0.02 : 0.003;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        checkpoint();
        setEdits((list) => list.map((ed) => (ed.id === selected ? moveEdit(ed, ...moves[e.key]) : ed)));
      }
    };
    // Capture, so this runs before the dialog's own Escape handler.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const pickTool = (value: Tool) => {
    setTool(value);
    if (value !== 'select') setSelected(null);
    if (value === 'image') fileRef.current?.click();
  };

  const replaceStatus =
    tool !== 'replace'
      ? null
      : source?.kind !== 'pdf'
        ? 'Photos have no text to edit. Use Add text and White-out instead.'
        : !lines
          ? 'Finding text…'
          : lines.length === 0
            ? 'No text found. This page may be a scan: use White-out and Add text.'
            : null;
  const hint = replaceStatus ?? (current ? null : TOOLS.find((t) => t.value === tool)!.hint);
  const px = (fraction: number) => fraction * box.h;
  const drawing = tool === 'whiteout' || tool === 'highlight' || tool === 'box' || tool === 'draw';

  const onViewPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size > 1) {
      armPinch();
      return;
    }
    if (!drawing && !drag.current) {
      const view = viewRef.current;
      panRef.current = view ? { x: e.clientX, y: e.clientY, sl: view.scrollLeft, st: view.scrollTop, moved: false } : null;
    }
  };

  const onViewPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pinch = pinchRef.current;
    if (pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      queueZoom(pinch.zoom * (dist / pinch.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const pan = panRef.current;
    const view = viewRef.current;
    if (!pan || !view || drag.current || drawing) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (!pan.moved && Math.hypot(dx, dy) < 8) return;
    pan.moved = true;
    view.scrollLeft = pan.sl - dx;
    view.scrollTop = pan.st - dy;
  };

  const onViewPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    panRef.current = null;
    if (pinchUsed.current) {
      if (pointers.current.size < 2) commitZoom();
      if (pointers.current.size === 0) pinchUsed.current = false;
      return;
    }
    const tappedEdit = (e.target as HTMLElement).closest('button, textarea');
    if (pan?.moved || tappedEdit || drawing || (tool !== 'select' && tool !== 'replace')) return;
    const now = Date.now();
    const last = lastTap.current;
    if (now - last.t < 280 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 28) {
      glideZoom(shownRef.current > 1.05 ? 1 : 2, e.clientX, e.clientY);
      lastTap.current = { t: 0, x: 0, y: 0 };
    } else {
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    }
  };

  const prevId = position > 0 ? order[position - 1] : null;
  const nextId = position < order.length - 1 ? order[position + 1] : null;

  // What the properties bar shows: the selected change's style, or the style the current tool will use.
  let properties: ReactNode = null;
  if (current?.kind === 'text') {
    properties = (
      <TextControls
        value={{ font: current.font, sizePt: Math.round(current.size * pageHeightPt * 2) / 2, bold: current.bold, italic: current.italic, color: current.color, align: current.align }}
        onChange={({ sizePt, align, ...look }) => {
          remember({ ...look, ...(sizePt ? { size: sizePt } : {}) });
          change(current.id, { ...look, ...(align ? { align } : {}), ...(sizePt ? { size: sizePt / pageHeightPt } : {}) });
        }}
      />
    );
    if (current.background) {
      properties = (
        <>
          {properties}
          <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted" title="Colour that covers the original text">
            Cover
            <input type="color" value={current.background} onChange={(e) => change(current.id, { background: e.target.value })} className="h-7 w-9 cursor-pointer rounded border border-border" />
          </label>
        </>
      );
    }
  } else if (current?.kind === 'highlight') {
    properties = (
      <Swatches colors={HIGHLIGHTS} value={current.color} label="Highlight colour" onChange={(color) => {
        remember({ highlight: color });
        change(current.id, { color });
      }} />
    );
  } else if (current?.kind === 'box') {
    properties = (
      <Swatches colors={COLORS.slice(0, 6)} value={current.color} label="Shape colour" onChange={(color) => {
        remember({ shape: color });
        change(current.id, { color });
      }} />
    );
  } else if (current?.kind === 'whiteout') {
    properties = <Swatches colors={COLORS} value={current.color} label="Fill colour" onChange={(color) => change(current.id, { color })} />;
  } else if (current?.kind === 'draw') {
    properties = (
      <>
        <Swatches colors={COLORS.slice(0, 6)} value={current.color} label="Ink colour" onChange={(color) => {
          remember({ ink: color });
          change(current.id, { color });
        }} />
        <ThicknessPicker value={current.thickness} onChange={(thickness) => {
          remember({ thickness });
          change(current.id, { thickness });
        }} />
      </>
    );
  } else if (!current && tool === 'text') {
    properties = (
      <TextControls
        value={{ font: style.font, sizePt: style.size, bold: style.bold, italic: style.italic, color: style.color }}
        onChange={({ sizePt, ...look }) => remember({ ...look, ...(sizePt ? { size: sizePt } : {}) })}
      />
    );
  } else if (!current && tool === 'draw') {
    properties = (
      <>
        <Swatches colors={COLORS.slice(0, 6)} value={style.ink} label="Ink colour" onChange={(ink) => remember({ ink })} />
        <ThicknessPicker value={style.thickness} onChange={(thickness) => remember({ thickness })} />
      </>
    );
  } else if (!current && tool === 'highlight') {
    properties = <Swatches colors={HIGHLIGHTS} value={style.highlight} label="Highlight colour" onChange={(highlight) => remember({ highlight })} />;
  } else if (!current && tool === 'box') {
    properties = <Swatches colors={COLORS.slice(0, 6)} value={style.shape} label="Shape colour" onChange={(shape) => remember({ shape })} />;
  }

  return (
    <>
      {/* Top bar: close, file, pages, undo and redo, finish. */}
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-2 sm:gap-2 sm:px-3">
        <IconButton label="Close editor (changes are kept)" icon={X} onClick={onClose} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">Edit PDF</p>
          <p className="truncate text-xs text-muted">{source?.name}</p>
        </div>
        <div className="flex shrink-0 items-center rounded-lg border border-border">
          <IconButton label="Previous page" icon={ChevronLeft} disabled={!prevId} onClick={() => prevId && onNavigate(prevId)} compact />
          <span className="tabular px-1 text-xs font-medium whitespace-nowrap text-fg" aria-live="polite">
            <span className="hidden sm:inline">Page </span>
            {position + 1} / {order.length}
          </span>
          <IconButton label="Next page" icon={ChevronRight} disabled={!nextId} onClick={() => nextId && onNavigate(nextId)} compact />
        </div>
        <Divider />
        <IconButton label="Undo (Ctrl+Z)" icon={Undo2} disabled={!past.length} onClick={undo} />
        <IconButton label="Redo (Ctrl+Shift+Z)" icon={Redo2} disabled={!future.length} onClick={redo} />
        <Button variant="secondary" size="sm" className="ml-1 hidden sm:inline-flex" onClick={onClose}>
          Done
        </Button>
        <Button variant="primary" size="sm" aria-label="Download PDF" onClick={onDownload} disabled={busy} icon={<Download className="h-4 w-4" aria-hidden />}>
          <span className="hidden sm:inline">Download</span>
        </Button>
      </header>

      {/* Tools: big, labelled, one tap each. */}
      <div className="shrink-0 overflow-x-auto border-b border-border bg-surface">
        <div role="toolbar" aria-label="Edit tools" className="mx-auto flex w-max gap-1 px-2 py-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={tool === t.value}
              onClick={() => pickTool(t.value)}
              className={cn(
                'flex min-w-16 flex-col items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition-colors sm:min-w-[4.5rem]',
                tool === t.value ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              <t.icon className="h-5 w-5" aria-hidden />
              {t.label}
            </button>
          ))}
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => {
            void onPicture(e.target.files?.[0]);
            e.target.value = '';
          }} />
        </div>
      </div>

      {/* Properties of the selection, or of what the tool will make. */}
      {(properties || current) && (
        <div className="shrink-0 overflow-x-auto border-b border-border bg-surface-2/60">
          <div className="mx-auto flex w-max min-w-full items-center justify-center gap-3 px-3 py-2" aria-live="polite">
            {properties}
            {current && (
              <>
                {properties && <Divider />}
                <Button variant="danger" size="sm" onClick={() => remove(current.id)} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <PageRail current={page.id} editsHere={edits.length} onPick={onNavigate} />

        <main className="relative min-w-0 flex-1 bg-surface-2">
          <div
            ref={viewRef}
            onPointerDown={onViewPointerDown}
            onPointerMove={onViewPointerMove}
            onPointerUp={onViewPointerUp}
            onPointerCancel={onViewPointerUp}
            className="absolute inset-0 flex touch-none overflow-auto overscroll-contain p-4 sm:p-8"
          >
            {ready && (
              <div
                ref={boxRef}
                data-surface="1"
                onPointerDown={onBoxDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                className={cn(
                  'relative m-auto shrink-0 overflow-hidden bg-white shadow-[0_2px_12px_rgb(0_0_0/0.15)] select-none',
                  drawing && 'touch-none',
                  tool === 'text' && 'cursor-text',
                  drawing && 'cursor-crosshair',
                )}
                style={{ width: widthFor(zoom), aspectRatio: preview ? `${preview.width} / ${preview.height}` : '3 / 4' }}
              >
                {preview ? (
                  <img src={preview.url} alt="" draggable={false} data-surface="1" className="pointer-events-none absolute inset-0 h-full w-full" />
                ) : (
                  <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading page…
                  </p>
                )}

                <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
                  {edits.map((ed) =>
                    ed.kind === 'draw'
                      ? ed.strokes.map((s, i) => (
                          <polyline
                            key={`${ed.id}-${i}`}
                            points={s.map(([x, y]) => `${x},${y}`).join(' ')}
                            fill="none"
                            stroke={ed.color}
                            strokeWidth={ed.thickness * box.w}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))
                      : null,
                  )}
                </svg>

                {edits.map((ed) => {
                  if (ed.kind === 'draw') {
                    const xs = ed.strokes.flat().map((p) => p[0]);
                    const ys = ed.strokes.flat().map((p) => p[1]);
                    const x = Math.min(...xs);
                    const y = Math.min(...ys);
                    // An invisible box over the drawing, to select and move it.
                    return (
                      <div
                        key={ed.id}
                        role="button"
                        tabIndex={0}
                        aria-label="Drawing. Drag to move, Delete removes it."
                        onPointerDown={(e) => onItemDown(e, ed)}
                        onFocus={() => setSelected(ed.id)}
                        className={cn('absolute cursor-move rounded-sm', selected === ed.id && 'outline-1 outline-accent outline-dashed', tool === 'draw' && 'pointer-events-none')}
                        style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${(Math.max(...xs) - x) * 100 + 0.5}%`, height: `${(Math.max(...ys) - y) * 100 + 0.5}%` }}
                      />
                    );
                  }
                  const isSel = selected === ed.id;
                  const common = cn(
                    'group absolute',
                    tool === 'draw' && 'pointer-events-none',
                    isSel ? 'outline-2 outline-accent outline-solid' : 'hover:outline-1 hover:outline-accent/60 hover:outline-dashed',
                  );
                  const handle = isSel && (
                    <span
                      aria-hidden
                      onPointerDown={(e) => onItemDown(e, ed, 'resize')}
                      className="absolute -right-2.5 -bottom-2.5 z-10 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-white bg-accent shadow"
                    />
                  );
                  if (ed.kind === 'text') {
                    const font = `${ed.italic ? 'italic ' : ''}${ed.bold ? '700' : '400'} ${px(ed.size)}px/${EDIT_LINE_HEIGHT} ${EDIT_CSS_FONT[ed.font]}`;
                    const textStyle = { font, color: ed.color, textAlign: ed.align } as const;
                    return (
                      <div
                        key={ed.id}
                        onPointerDown={(e) => onItemDown(e, ed)}
                        className={cn(common, !isSel && 'cursor-move')}
                        style={{
                          left: `${ed.x * 100}%`,
                          top: `${ed.y * 100}%`,
                          width: `${ed.width * 100}%`,
                          minHeight: ed.coverHeight ? `${ed.coverHeight * 100}%` : undefined,
                          background: ed.background,
                        }}
                      >
                        {isSel ? (
                          <>
                            <TextArea
                              edit={ed}
                              style={textStyle}
                              autoFocus={focusId === ed.id}
                              onFocused={() => setFocusId(null)}
                              onFocus={checkpoint}
                              onBlur={dropUnchanged}
                              onChange={(text) => update(ed.id, { text })}
                            />
                            <span
                              aria-hidden
                              onPointerDown={(e) => onItemDown(e, ed)}
                              className="absolute -top-3.5 -left-3.5 z-10 inline-flex h-7 w-7 cursor-move items-center justify-center rounded-full bg-accent text-accent-fg shadow"
                            >
                              <Move className="h-3.5 w-3.5" />
                            </span>
                          </>
                        ) : (
                          <div className="break-words whitespace-pre-wrap" style={textStyle}>
                            {ed.text || <span className="text-gray-400">Type here</span>}
                          </div>
                        )}
                        {handle}
                      </div>
                    );
                  }
                  const rectStyle = { left: `${ed.x * 100}%`, top: `${ed.y * 100}%`, width: `${ed.width * 100}%`, height: `${ed.height * 100}%` };
                  return (
                    <div
                      key={ed.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${ed.kind === 'image' ? 'Picture' : ed.kind === 'whiteout' ? 'White-out' : ed.kind === 'highlight' ? 'Highlight' : 'Shape'}. Drag to move, Delete removes it.`}
                      onFocus={() => setSelected(ed.id)}
                      onPointerDown={(e) => onItemDown(e, ed)}
                      className={cn(common, 'cursor-move')}
                      style={{
                        ...rectStyle,
                        background: ed.kind === 'whiteout' ? ed.color : ed.kind === 'highlight' ? ed.color : undefined,
                        mixBlendMode: ed.kind === 'highlight' ? 'multiply' : undefined,
                        opacity: ed.kind === 'highlight' ? 0.55 : undefined,
                        border: ed.kind === 'box' ? `${Math.max(1, (1.5 / pageHeightPt) * box.h)}px solid ${ed.color}` : undefined,
                      }}
                    >
                      {ed.kind === 'image' && editImages[ed.imageId] && (
                        <img src={editImages[ed.imageId].url} alt="" draggable={false} className="pointer-events-none h-full w-full" />
                      )}
                      {handle}
                    </div>
                  );
                })}

                {tool === 'replace' &&
                  (lines ?? []).map((line, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-label={`Edit text: ${line.text}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onReplace(line)}
                      className="absolute rounded-sm bg-accent/10 outline-1 outline-accent/40 transition-colors outline-dashed hover:bg-accent/25"
                      style={{ left: `${line.x * 100}%`, top: `${line.y * 100}%`, width: `${line.width * 100}%`, height: `${line.height * 100}%` }}
                    />
                  ))}
              </div>
            )}
          </div>

          {hint && (
            <p className="pointer-events-none absolute inset-x-0 top-3 z-10 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-xs text-white shadow-lg" aria-live="polite">
              {replaceStatus === 'Finding text…' ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden /> : <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              {hint}
            </p>
          )}

          <div className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface/95 p-1 shadow-lg backdrop-blur">
            <IconButton
              label="Zoom out"
              icon={ZoomOut}
              disabled={zoom <= ZOOM_MIN}
              round
              onClick={() => {
                const c = viewCenter();
                glideZoom(shownRef.current - ZOOM_STEP, c.x, c.y);
              }}
            />
            <button
              type="button"
              title="Fit page"
              onClick={() => {
                const c = viewCenter();
                glideZoom(1, c.x, c.y);
              }}
              className="tabular min-w-12 rounded-full px-1 py-1.5 text-center text-xs font-medium text-fg hover:bg-surface-2"
            >
              <span ref={zoomLabel}>{Math.round(zoom * 100)}%</span>
            </button>
            <IconButton
              label="Zoom in"
              icon={ZoomIn}
              disabled={zoom >= ZOOM_MAX}
              round
              onClick={() => {
                const c = viewCenter();
                glideZoom(shownRef.current + ZOOM_STEP, c.x, c.y);
              }}
            />
          </div>
        </main>
      </div>
    </>
  );
}

/** A textarea that grows with its text, styled like the text it edits. */
function TextArea({ edit, style, autoFocus, onFocused, onFocus, onBlur, onChange }: {
  edit: TextEdit;
  style: { font: string; color: string; textAlign: 'left' | 'center' | 'right' };
  autoFocus: boolean;
  onFocused: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onChange: (text: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  });
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      ref.current.select();
      onFocused();
    }
  }, [autoFocus, onFocused]);
  return (
    <textarea
      ref={ref}
      value={edit.text}
      rows={1}
      placeholder="Type here"
      aria-label="Text"
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-gray-400"
      style={{ ...style, touchAction: 'auto' }}
    />
  );
}

/**
 * The full-screen editor, opened on the page whose Edit button was pressed. Moving to another
 * page, closing or downloading keeps every change; Undo takes back mistakes.
 */
export function EditDialog() {
  const pageId = usePdfStore((s) => s.editingPageId);
  const page = usePdfStore((s) => s.pages.find((p) => p.id === pageId));
  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = useState<EditStyle>(DEFAULT_STYLE);
  const saveRef = useRef<(() => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const open = !!page;

  const close = () => {
    saveRef.current?.();
    usePdfStore.getState().setEditingPage(null);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  // A stable callback, so the dialog hook does not restart on every render.
  const [onDialogClose] = useState(() => () => closeRef.current());
  useDialog(open, onDialogClose, panelRef);

  if (!page) return null;
  const navigate = (id: string) => {
    saveRef.current?.();
    usePdfStore.getState().setEditingPage(id);
  };
  const download = () => {
    close();
    void savePdf(usePdfStore.getState().pages);
  };

  return createPortal(
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Edit PDF" className="fixed inset-0 z-50 flex flex-col bg-bg">
      <Editor
        key={page.id}
        page={page}
        tool={tool}
        setTool={setTool}
        style={style}
        setStyle={setStyle}
        saveRef={saveRef}
        onNavigate={navigate}
        onClose={close}
        onDownload={download}
      />
    </div>,
    document.body,
  );
}
