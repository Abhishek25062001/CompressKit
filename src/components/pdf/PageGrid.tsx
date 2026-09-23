import { Check, ChevronLeft, ChevronRight, FileText, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { memo, useState, type DragEvent } from 'react';
import { usePdfStore } from '../../store/pdfStore';
import { cn } from '../../utils/cn';

/** MIME type for dragging a page inside the grid, so file drops and page moves never mix. */
const PAGE_DRAG_TYPE = 'application/x-compresskit-page';

interface PageCardProps {
  id: string;
  position: number;
  total: number;
  dropTarget: boolean;
  onDragTarget: (id: string | null) => void;
}

const PageCard = memo(function PageCard({ id, position, total, dropTarget, onDragTarget }: PageCardProps) {
  const page = usePdfStore((s) => s.pages.find((p) => p.id === id));
  const source = usePdfStore((s) => (page ? s.sources[page.sourceId] : undefined));
  const busy = usePdfStore((s) => s.busy !== null);
  const { toggleSelected, rotatePage, removePage, movePage } = usePdfStore.getState();
  if (!page || !source) return null;

  const label = `Page ${position + 1}`;
  const origin = source.kind === 'pdf' ? `${source.name} · p. ${page.index + 1}` : source.name;

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(PAGE_DRAG_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(PAGE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    onDragTarget(id);
  };
  const onDrop = (e: DragEvent) => {
    const dragged = e.dataTransfer.getData(PAGE_DRAG_TYPE);
    onDragTarget(null);
    if (!dragged || dragged === id) return;
    e.preventDefault();
    movePage(dragged, position);
  };

  return (
    <li
      draggable={!busy}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={() => onDragTarget(null)}
      onDrop={onDrop}
      onDragEnd={() => onDragTarget(null)}
      className={cn(
        'card group relative flex flex-col overflow-hidden transition-colors',
        page.selected && 'border-accent ring-1 ring-accent',
        dropTarget && 'ring-2 ring-accent/60',
      )}
    >
      <button
        type="button"
        onClick={() => toggleSelected(id)}
        aria-pressed={page.selected}
        aria-label={`${page.selected ? 'Deselect' : 'Select'} ${label}, from ${origin}`}
        className="relative block aspect-square cursor-pointer bg-surface-2/60 p-2 outline-offset-[-2px]"
      >
        {page.thumbUrl ? (
          <img
            src={page.thumbUrl}
            alt=""
            draggable={false}
            className="h-full w-full object-contain transition-transform duration-200"
            style={{ transform: `rotate(${page.rotation}deg)` }}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted" aria-hidden>
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
        )}
        <span
          aria-hidden
          className={cn(
            'absolute top-2 left-2 inline-flex h-5 w-5 items-center justify-center rounded-md border transition-colors',
            page.selected ? 'border-accent bg-accent text-accent-fg' : 'border-border-strong bg-surface/90 text-transparent',
          )}
        >
          <Check className="h-3.5 w-3.5" />
        </span>
      </button>
      <div className="flex items-center gap-2 border-t border-border px-2.5 pt-2">
        <span className="tabular font-mono text-sm font-semibold text-fg">{position + 1}</span>
        <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted" title={origin}>
          <FileText className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{origin}</span>
        </span>
      </div>
      <div className="flex items-center justify-between px-1 pt-1 pb-1.5">
        {[
          { icon: ChevronLeft, text: `Move ${label} earlier`, onClick: () => movePage(id, position - 1), disabled: position === 0 },
          { icon: RotateCw, text: `Rotate ${label}`, onClick: () => rotatePage(id, 90), disabled: false },
          { icon: Trash2, text: `Remove ${label}`, onClick: () => removePage(id), disabled: false },
          { icon: ChevronRight, text: `Move ${label} later`, onClick: () => movePage(id, position + 1), disabled: position === total - 1 },
        ].map(({ icon: Icon, text, onClick, disabled }) => (
          <button
            key={text}
            type="button"
            aria-label={text}
            title={text}
            onClick={onClick}
            disabled={disabled || busy}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        ))}
      </div>
    </li>
  );
});

export function PageGrid() {
  const ids = usePdfStore((s) => s.pages.map((p) => p.id).join(','));
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const order = ids ? ids.split(',') : [];

  return (
    <ul aria-label="Pages" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {order.map((id, i) => (
        <PageCard key={id} id={id} position={i} total={order.length} dropTarget={dropTarget === id} onDragTarget={setDropTarget} />
      ))}
    </ul>
  );
}
