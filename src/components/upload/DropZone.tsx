import { motion } from 'framer-motion';
import { Plus, UploadCloud } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { fileInputId, useTool } from '../../features/tools';
import { cn } from '../../utils/cn';

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

interface FileDropZoneProps {
  inputId: string;
  accept: string;
  badges: string[];
  onFiles: (files: FileList) => void;
  compact?: boolean;
  /** Replaces "Drop your files here" on the full-size zone. */
  title?: string;
  /** Less vertical padding, for a drop zone that shares the screen with other content. */
  short?: boolean;
}

/** Drop zone for the queue tool on screen, which supplies its formats through the tool context. */
export function DropZone({ compact = false }: { compact?: boolean }) {
  const { mode, addFiles, accept, badges } = useTool();
  return <FileDropZone inputId={fileInputId(mode)} accept={accept} badges={badges} onFiles={addFiles} compact={compact} />;
}

export function FileDropZone({ inputId, accept, badges, onFiles, compact = false, title = 'Drop your files here', short = false }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current++;
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };

  const browse = () => inputRef.current?.click();

  return (
    <motion.div
      layout
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      animate={{ scale: dragging ? 1.01 : 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={cn(
        'group relative rounded-3xl border-2 border-dashed transition-colors duration-200',
        dragging
          ? 'border-accent bg-accent-soft/70'
          : 'border-border-strong/80 bg-surface/70 hover:border-accent/60 hover:bg-surface',
      )}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={browse}
        aria-describedby="ck-drop-formats"
        className={cn(
          'flex w-full flex-col items-center justify-center rounded-[22px] text-center outline-offset-4',
          compact ? 'gap-2 px-4 py-6 sm:flex-row sm:gap-4 sm:py-5' : short ? 'gap-3 px-6 py-8 sm:py-10' : 'gap-4 px-6 py-12 sm:py-20',
        )}
      >
        <motion.span
          animate={dragging ? { y: -6, scale: 1.08 } : { y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className={cn(
            'inline-flex items-center justify-center rounded-2xl border border-border bg-surface text-accent-text shadow-[var(--shadow-soft)] transition-colors group-hover:border-accent/50',
            compact ? 'h-10 w-10' : 'h-16 w-16 sm:h-20 sm:w-20',
          )}
        >
          {compact ? <Plus className="h-5 w-5" aria-hidden /> : <UploadCloud className="h-8 w-8 sm:h-9 sm:w-9" aria-hidden />}
        </motion.span>
        <span className={cn('flex flex-col', compact ? 'items-center sm:items-start' : 'items-center')}>
          <span className={cn('font-semibold tracking-tight text-fg', compact ? 'text-base' : 'text-xl sm:text-2xl')}>
            {dragging ? 'Release to add files' : compact ? 'Add more files' : title}
          </span>
          <span className="mt-1 text-sm text-muted">
            or <span className="font-medium text-accent-text underline-offset-4 group-hover:underline">click to browse</span>
          </span>
        </span>
        {!compact && (
          <span id="ck-drop-formats" className="mt-2 flex max-w-md flex-wrap justify-center gap-1.5">
            {badges.map((f) => (
              <span
                key={f}
                className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px] font-medium text-muted"
              >
                {f}
              </span>
            ))}
          </span>
        )}
        {compact && (
          <span id="ck-drop-formats" className="sr-only">
            Supported formats: {badges.join(', ')}
          </span>
        )}
      </button>
    </motion.div>
  );
}
