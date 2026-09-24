import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, FileQuestion, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TOOL_BY_ID } from '../../features/catalog';
import { ANY_TOOL_ACCEPT, matchTools, openToolWith, type ToolMatch } from '../../features/handoff';
import { TOOL_CONTENT } from '../../features/toolContent';
import { useRouteStore } from '../../store/routeStore';
import { Button } from '../common/Button';
import { FileDropZone } from '../upload/DropZone';

const BADGES = ['JPG', 'PNG', 'HEIC', 'WebP', 'MP4', 'MOV', 'PDF'];

function describe(files: File[]): string {
  if (files.length === 1) return files[0].name;
  const count = (test: (f: File) => boolean) => files.filter(test).length;
  const photos = count((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|avif|bmp)$/i.test(f.name));
  const videos = count((f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v|avi|3gp)$/i.test(f.name));
  const pdfs = count((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  const parts = [
    photos && `${photos} photo${photos === 1 ? '' : 's'}`,
    videos && `${videos} video${videos === 1 ? '' : 's'}`,
    pdfs && `${pdfs} PDF${pdfs === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : `${files.length} files`;
}

function MatchButton({ match, total, onPick }: { match: ToolMatch; total: number; onPick: () => void }) {
  const tool = TOOL_BY_ID[match.id];
  const Icon = TOOL_CONTENT[match.id].icon;
  const partial = match.files.length < total;
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-accent-soft/40"
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
        <Icon className="h-4.5 w-4.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg">{tool.name}</span>
        <span className="block truncate text-xs text-muted">
          {match.id === 'trim' && match.files.length > 1
            ? 'Opens the first video'
            : partial
              ? `Uses ${match.files.length} of ${total} files`
              : tool.tagline}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" aria-hidden />
    </button>
  );
}

/**
 * The home page's starting point for people who have a file rather than a tool in mind: drop it,
 * see which tools can open it, and continue in that tool with the file already added.
 */
export function SmartDrop() {
  const [files, setFiles] = useState<File[] | null>(null);
  const navigate = useRouteStore((s) => s.navigate);
  const matches = files ? matchTools(files) : [];

  // Pasting a screenshot or a copied file works here too.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        setFiles(Array.from(e.clipboardData.files));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const pick = (match: ToolMatch) => {
    openToolWith(match.id, match.files);
    navigate(TOOL_BY_ID[match.id].path);
  };

  return (
    <AnimatePresence mode="wait" initial={false}>
      {!files ? (
        <motion.div key="drop" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
          <FileDropZone
            inputId="ck-file-input-home"
            accept={ANY_TOOL_ACCEPT}
            badges={BADGES}
            onFiles={(list) => setFiles(Array.from(list))}
            title="Drop a photo, video or PDF"
            short
          />
          <p className="mt-3 text-sm text-muted">We&apos;ll show you what you can do with it. Nothing is uploaded.</p>
        </motion.div>
      ) : (
        <motion.section
          key="choose"
          aria-labelledby="smart-drop-title"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="card p-4 text-left sm:p-5"
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="smart-drop-title" className="text-base font-semibold text-fg">
                {matches.length ? 'What would you like to do?' : 'No tool can open this file'}
              </h2>
              <p className="truncate text-sm text-muted">{describe(files)}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setFiles(null)} icon={<X className="h-4 w-4" aria-hidden />}>
              Clear
            </Button>
          </div>
          {matches.length ? (
            <ul className="grid gap-2 sm:grid-cols-2">
              {matches.map((m) => (
                <li key={m.id}>
                  <MatchButton match={m} total={files.length} onPick={() => pick(m)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-start gap-2 rounded-xl bg-surface-2/60 p-3 text-sm text-muted">
              <FileQuestion className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              CompressKit works with photos (JPG, PNG, HEIC, WebP, AVIF, BMP), videos (MP4, MOV, WebM, MKV and more) and PDFs.
            </p>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}
