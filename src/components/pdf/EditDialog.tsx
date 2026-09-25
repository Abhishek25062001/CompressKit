import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Highlighter,
  ImagePlus,
  Italic,
  Loader2,
  MousePointer2,
  Move,
  PenLine,
  Square,
  TextCursorInput,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PageTextLine } from '../../features/docs/pdfExtract';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../../features/image/canvas';
import { decodeImage } from '../../features/image/decode';
import { getOpenPdf } from '../../features/pdf/documents';
import { EDIT_CSS_FONT, EDIT_LINE_HEIGHT } from '../../features/pdf/edits';
import { usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PageEdit, PdfPage } from '../../types/pdf';
import { cn } from '../../utils/cn';
import { createId } from '../../utils/id';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { usePagePreview } from '../../hooks/usePagePreview';

type Tool = 'select' | 'replace' | 'text' | 'whiteout' | 'highlight' | 'box' | 'draw' | 'image';
type TextEdit = Extract<PageEdit, { kind: 'text' }>;
type RectEdit = Extract<PageEdit, { kind: 'whiteout' | 'highlight' | 'box' }>;

const TOOLS: { value: Tool; label: string; icon: LucideIcon; hint: string }[] = [
  { value: 'select', label: 'Select', icon: MousePointer2, hint: 'Click an edit to change it. Drag to move it.' },
  { value: 'replace', label: 'Edit text', icon: TextCursorInput, hint: 'Click a line of text on the page to retype it.' },
  { value: 'text', label: 'Add text', icon: Type, hint: 'Click where the text should go, then type.' },
  { value: 'whiteout', label: 'White-out', icon: Eraser, hint: 'Drag over what you want to hide.' },
  { value: 'highlight', label: 'Highlight', icon: Highlighter, hint: 'Drag over the text to highlight.' },
  { value: 'box', label: 'Box', icon: Square, hint: 'Drag to draw a box.' },
  { value: 'draw', label: 'Draw', icon: PenLine, hint: 'Draw freehand with your mouse, finger or pen.' },
  { value: 'image', label: 'Picture', icon: ImagePlus, hint: 'Pick a picture, then drag it into place.' },
];

const COLORS = ['#000000', '#4b5563', '#dc2626', '#2563eb', '#16a34a', '#ca8a04', '#ffffff'];
const HIGHLIGHTS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'];
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

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

function IconButton({ label, icon: Icon, active, onClick, disabled }: { label: string; icon: LucideIcon; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40',
        active ? 'bg-accent-soft text-accent-text ring-1 ring-accent/40' : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function Swatches({ colors, value, onChange, label }: { colors: string[]; value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
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

function Editor({ page, onClose }: { page: PdfPage; onClose: () => void }) {
  const preview = usePagePreview(page);
  const source = usePdfStore((s) => s.sources[page.sourceId]);
  const editImages = usePdfStore((s) => s.editImages);
  const [edits, setEdits] = useState<PageEdit[]>(() => page.edits ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [lines, setLines] = useState<PageTextLine[] | null>(null);
  const [pageHeightPt, setPageHeightPt] = useState(842);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sampler = useRef<{ ctx: CanvasRenderingContext2D; w: number; h: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // The last-used text style and colours, so new edits look like the previous one.
  const [style, setStyle] = useState({ size: 12, color: '#000000', font: 'sans' as TextEdit['font'], bold: false, italic: false, highlight: HIGHLIGHTS[0], ink: '#1d4ed8' });
  const remember = (patch: Partial<typeof style>) => setStyle((s) => ({ ...s, ...patch }));

  const current = edits.find((e) => e.id === selected) ?? null;
  const update = (id: string, patch: Partial<PageEdit>) =>
    setEdits((list) => list.map((e) => (e.id === id ? ({ ...e, ...patch } as PageEdit) : e)));
  const remove = (id: string) => {
    setEdits((list) => list.filter((e) => e.id !== id));
    setSelected(null);
  };

  // Page size in points, to show text sizes the way people know them.
  useEffect(() => {
    if (source?.kind !== 'pdf') return;
    void getOpenPdf(source.id)
      .view.getPage(page.index + 1)
      .then((p) => setPageHeightPt(p.getViewport({ scale: 1, rotation: (p.rotate + page.rotation) % 360 }).height));
  }, [source, page.index, page.rotation]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview]);

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
    setEdits((list) => [...list, { id, kind: 'text', ...edit }]);
    setSelected(id);
    setFocusId(id);
    setTool('select');
  };

  const onBoxDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.surface) return;
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
      const color = tool === 'whiteout' ? '#ffffff' : tool === 'highlight' ? s.highlight : s.color === '#ffffff' ? '#000000' : s.color;
      setEdits((list) => [...list, { id, kind: tool, x: p.x, y: p.y, width: 0, height: 0, color }]);
      setSelected(id);
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { kind: 'create', id, startX: p.x, startY: p.y };
      return;
    }
    if (tool === 'draw') {
      const id = createId();
      setEdits((list) => [...list, { id, kind: 'draw', strokes: [[[p.x, p.y]]], color: s.ink, thickness: 0.004 }]);
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
    if (!file) return;
    try {
      const picture = await readPicture(file);
      const id = createId();
      usePdfStore.getState().addEditImage(id, picture);
      const aspect = picture.height / picture.width;
      const width = 0.3;
      const height = preview ? (width * preview.width * aspect) / preview.height : width * aspect;
      const editId = createId();
      setEdits((list) => [...list, { id: editId, kind: 'image', x: 0.35, y: clamp(0.4 - height / 2, 0, 0.9), width, height, imageId: id }]);
      setSelected(editId);
      setTool('select');
    } catch {
      useUiStore.getState().pushNotice({ tone: 'error', title: "Couldn't open that picture", message: 'Try a JPG or PNG.' });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.target as HTMLElement).closest('textarea, input, select')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove(selected);
      }
      const step = e.shiftKey ? 0.02 : 0.003;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        setEdits((list) => list.map((ed) => (ed.id === selected ? moveEdit(ed, ...moves[e.key]) : ed)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const save = () => {
    // Empty text boxes that cover nothing are dropped.
    const kept = edits.filter((e) => !(e.kind === 'text' && !e.text.trim() && !e.background));
    usePdfStore.getState().updatePage(page.id, { edits: kept });
    onClose();
  };

  const hint = TOOLS.find((t) => t.value === tool)!.hint;
  const replaceUnavailable = tool === 'replace' && source?.kind !== 'pdf';
  const px = (fraction: number) => fraction * box.h;

  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title="Edit page"
      description="Changes are kept in this tab until you download the PDF."
      footer={
        <>
          <p className="mr-auto self-center text-xs text-muted">
            {edits.length ? `${edits.length} change${edits.length === 1 ? '' : 's'} on this page` : 'No changes yet'}
          </p>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div role="toolbar" aria-label="Edit tools" className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1">
          {TOOLS.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={tool === t.value}
              onClick={() => {
                setTool(t.value);
                if (t.value !== 'select') setSelected(null);
                if (t.value === 'image') fileRef.current?.click();
              }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all',
                tool === t.value ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg',
              )}
            >
              <t.icon className={cn('h-3.5 w-3.5', tool === t.value && 'text-accent-text')} aria-hidden />
              {t.label}
            </button>
          ))}
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => {
            void onPicture(e.target.files?.[0]);
            e.target.value = '';
          }} />
        </div>

        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2" aria-live="polite">
          {current?.kind === 'text' ? (
            <>
              <select
                aria-label="Font"
                value={current.font}
                onChange={(e) => {
                  const font = e.target.value as TextEdit['font'];
                  remember({ font });
                  update(current.id, { font });
                }}
                className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
              >
                <option value="sans">Helvetica</option>
                <option value="serif">Times</option>
                <option value="mono">Courier</option>
              </select>
              <label className="inline-flex items-center gap-1 text-xs text-muted">
                Size
                <input
                  type="number"
                  min={4}
                  max={200}
                  step={0.5}
                  value={Math.round(current.size * pageHeightPt * 2) / 2}
                  onChange={(e) => {
                    const pt = clamp(Number(e.target.value) || 12, 4, 200);
                    remember({ size: pt });
                    update(current.id, { size: pt / pageHeightPt });
                  }}
                  className="tabular h-8 w-16 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
                />
              </label>
              <div className="flex gap-0.5">
                <IconButton label="Bold" icon={Bold} active={current.bold} onClick={() => {
                  remember({ bold: !current.bold });
                  update(current.id, { bold: !current.bold });
                }} />
                <IconButton label="Italic" icon={Italic} active={current.italic} onClick={() => {
                  remember({ italic: !current.italic });
                  update(current.id, { italic: !current.italic });
                }} />
                <IconButton label="Align left" icon={AlignLeft} active={current.align === 'left'} onClick={() => update(current.id, { align: 'left' })} />
                <IconButton label="Align center" icon={AlignCenter} active={current.align === 'center'} onClick={() => update(current.id, { align: 'center' })} />
                <IconButton label="Align right" icon={AlignRight} active={current.align === 'right'} onClick={() => update(current.id, { align: 'right' })} />
              </div>
              <Swatches colors={COLORS.slice(0, 6)} value={current.color} label="Text colour" onChange={(color) => {
                remember({ color });
                update(current.id, { color });
              }} />
              {current.background && (
                <label className="inline-flex items-center gap-1.5 text-xs text-muted" title="Colour that covers the original text">
                  Cover
                  <input type="color" value={current.background} onChange={(e) => update(current.id, { background: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-border" />
                </label>
              )}
            </>
          ) : current?.kind === 'highlight' ? (
            <Swatches colors={HIGHLIGHTS} value={current.color} label="Highlight colour" onChange={(color) => {
              remember({ highlight: color });
              update(current.id, { color });
            }} />
          ) : current?.kind === 'box' || current?.kind === 'whiteout' ? (
            <Swatches colors={COLORS} value={current.color} label={current.kind === 'box' ? 'Box colour' : 'Fill colour'} onChange={(color) => update(current.id, { color })} />
          ) : current?.kind === 'draw' ? (
            <>
              <Swatches colors={COLORS.slice(0, 6)} value={current.color} label="Ink colour" onChange={(color) => {
                remember({ ink: color });
                update(current.id, { color });
              }} />
              <select
                aria-label="Line width"
                value={String(current.thickness)}
                onChange={(e) => update(current.id, { thickness: Number(e.target.value) })}
                className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
              >
                <option value="0.002">Thin</option>
                <option value="0.004">Medium</option>
                <option value="0.008">Thick</option>
              </select>
            </>
          ) : tool === 'draw' ? (
            <Swatches colors={COLORS.slice(0, 6)} value={style.ink} label="Ink colour" onChange={(ink) => remember({ ink })} />
          ) : (
            <p className="text-xs text-muted">{replaceUnavailable ? 'Photos have no text to edit. Use Add text and White-out instead.' : hint}</p>
          )}
          {current && (
            <Button variant="danger" size="sm" className="ml-auto" onClick={() => remove(current.id)} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}>
              Delete
            </Button>
          )}
        </div>

        <div
          ref={boxRef}
          data-surface="1"
          onPointerDown={onBoxDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className={cn(
            'relative mx-auto w-full touch-none overflow-hidden rounded-xl border border-border bg-white select-none',
            tool === 'text' && 'cursor-text',
            (tool === 'whiteout' || tool === 'highlight' || tool === 'box' || tool === 'draw') && 'cursor-crosshair',
          )}
          style={
            preview
              ? { aspectRatio: `${preview.width} / ${preview.height}`, maxWidth: `calc(62dvh * ${preview.width / preview.height})` }
              : { aspectRatio: '3 / 4', maxWidth: 'calc(62dvh * 0.75)' }
          }
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
                className="absolute -right-2 -bottom-2 z-10 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-accent shadow"
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
                      <TextArea edit={ed} style={textStyle} autoFocus={focusId === ed.id} onFocused={() => setFocusId(null)} onChange={(text) => update(ed.id, { text })} />
                      <span
                        aria-hidden
                        onPointerDown={(e) => onItemDown(e, ed)}
                        className="absolute -top-3 -left-3 z-10 inline-flex h-6 w-6 cursor-move items-center justify-center rounded-full bg-accent text-accent-fg shadow"
                      >
                        <Move className="h-3 w-3" />
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
                aria-label={`${ed.kind === 'image' ? 'Picture' : ed.kind === 'whiteout' ? 'White-out' : ed.kind === 'highlight' ? 'Highlight' : 'Box'}. Drag to move, Delete removes it.`}
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
          {tool === 'replace' && source?.kind === 'pdf' && !lines && (
            <p className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white">Finding text…</p>
          )}
          {tool === 'replace' && lines?.length === 0 && (
            <p className="absolute inset-x-0 top-3 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white">
              No text found. This page may be a scan: use White-out and Add text.
            </p>
          )}
        </div>
        <p className="text-center text-xs text-muted">
          Replaced text is covered and retyped in a standard font, so it may look slightly different from the original.
        </p>
      </div>
    </Modal>
  );
}

/** A textarea that grows with its text, styled like the text it edits. */
function TextArea({ edit, style, autoFocus, onFocused, onChange }: {
  edit: TextEdit;
  style: { font: string; color: string; textAlign: 'left' | 'center' | 'right' };
  autoFocus: boolean;
  onFocused: () => void;
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
      onChange={(e) => onChange(e.target.value)}
      className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-gray-400"
      style={style}
    />
  );
}

/** Opens for the page whose Edit button was pressed. */
export function EditDialog() {
  const pageId = usePdfStore((s) => s.editingPageId);
  const page = usePdfStore((s) => s.pages.find((p) => p.id === pageId));
  const close = () => usePdfStore.getState().setEditingPage(null);
  if (!page) return null;
  return <Editor key={page.id} page={page} onClose={close} />;
}
