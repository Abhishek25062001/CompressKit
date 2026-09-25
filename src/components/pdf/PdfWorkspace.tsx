import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CheckSquare, Loader2, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { acceptAttribute } from '../../constants/formats';
import { addPdfFiles, PDF_BADGES, PDF_INPUT_FORMATS } from '../../features/pdf/intake';
import { fileInputId } from '../../features/tools';
import { usePdfStore } from '../../store/pdfStore';
import { Button } from '../common/Button';
import { ProgressBar } from '../common/ProgressBar';
import { FileDropZone } from '../upload/DropZone';
import { EditDialog } from './EditDialog';
import { MergePanel } from './MergePanel';
import { PageGrid } from './PageGrid';
import { PdfPanel } from './PdfPanel';
import { PdfToolPicker } from './PdfToolPicker';
import { PDF_TOOL_BY_TAB, type PdfTab } from './pdfTools';
import { PasswordDialog } from './PasswordDialog';
import { ScanDialog } from './ScanDialog';
import { SignDialog } from './SignDialog';

const ACCEPT = acceptAttribute(PDF_INPUT_FORMATS);

function PdfBar() {
  const { pages, files, selected, busy, progress } = usePdfStore(
    useShallow((s) => ({
      pages: s.pages.length,
      files: Object.keys(s.sources).length,
      selected: s.pages.filter((p) => p.selected).length,
      busy: s.busy,
      progress: s.progress,
    })),
  );
  const { setSelection, pages: all, clear } = usePdfStore.getState();

  return (
    <div className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0" aria-live="polite">
          <p className="text-sm font-semibold text-fg">
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-accent-text" aria-hidden />
                {busy}…
              </span>
            ) : (
              `${pages} page${pages === 1 ? '' : 's'} from ${files} file${files === 1 ? '' : 's'}`
            )}
          </p>
          <p className="text-xs text-muted">
            {selected ? `${selected} selected · ` : ''}Drag pages to reorder. Click a page to select it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => setSelection(new Set(selected === pages ? [] : all.map((p) => p.id)))}
            icon={selected === pages ? <Square className="h-4 w-4" aria-hidden /> : <CheckSquare className="h-4 w-4" aria-hidden />}
            disabled={!!busy}
          >
            {selected === pages ? 'Select none' : 'Select all'}
          </Button>
          <Button variant="ghost" onClick={clear} icon={<Trash2 className="h-4 w-4" aria-hidden />} disabled={!!busy}>
            Clear
          </Button>
        </div>
      </div>
      {busy && (
        <div className="mt-3">
          <ProgressBar value={progress} label={busy} />
        </div>
      )}
    </div>
  );
}

const DROP_TITLE = {
  pdf: 'Drop your files here',
  edit: 'Drop a PDF to edit',
  merge: 'Drop PDFs, Word files and photos',
} as const;

/**
 * The page board, shared by PDF tools, Edit PDF and Merge documents: the same pages, with the
 * panel that suits the page it is on.
 */
export function PdfWorkspace({ variant = 'pdf' }: { variant?: 'pdf' | 'edit' | 'merge' }) {
  const hasPages = usePdfStore((s) => s.pages.length > 0);
  const busy = usePdfStore((s) => s.busy);
  // PDF tools shows its tools first and asks for files once one is picked. Edit PDF and Merge
  // documents are one tool each, so they ask for files straight away.
  const [picked, setPicked] = useState<PdfTab | null>(variant === 'edit' ? 'edit' : variant === 'merge' ? 'save' : null);
  const tool = picked ? PDF_TOOL_BY_TAB[picked] : null;
  const pick = (tab: PdfTab | null) => {
    setPicked(tab);
    requestAnimationFrame(() => document.getElementById('tool')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const onFiles = (files: FileList) => void addPdfFiles(Array.from(files));

  // Paste photos or PDFs anywhere on the page while the PDF tool is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        void addPdfFiles(Array.from(files));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const dropZone = (compact: boolean, short = false) => (
    <FileDropZone
      inputId={fileInputId('pdf')}
      accept={ACCEPT}
      badges={variant === 'pdf' && tool ? tool.badges : PDF_BADGES}
      onFiles={onFiles}
      compact={compact}
      short={short}
      title={variant === 'pdf' ? (tool?.dropTitle ?? 'Or drop your files here to start') : DROP_TITLE[variant]}
    />
  );
  const choosing = variant === 'pdf' && !tool;

  return (
    <>
      <SignDialog />
      <EditDialog />
      <ScanDialog />
      <PasswordDialog />
      <AnimatePresence mode="popLayout" initial={false}>
        {!hasPages ? (
          <motion.div
            key="pdf-empty"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="space-y-4"
          >
            {/* Picking a tool swaps the picker for that tool's drop zone, one after the other. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={choosing ? 'picker' : picked}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
                className={choosing ? 'space-y-6' : 'mx-auto max-w-3xl space-y-4'}
              >
                {choosing ? (
                  <>
                    <PdfToolPicker onPick={pick} />
                    <div className="mx-auto max-w-3xl">{dropZone(false, true)}</div>
                  </>
                ) : (
                  <>
                    {variant === 'pdf' && tool && (
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => pick(null)}
                          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                        >
                          <ArrowLeft className="h-4 w-4" aria-hidden />
                          All PDF tools
                        </button>
                        <div className="min-w-0 border-l border-border pl-3">
                          <p className="flex items-center gap-2 text-sm font-semibold text-fg">
                            <tool.icon className="h-4 w-4 text-accent-text" aria-hidden />
                            {tool.name}
                          </p>
                          <p className="text-xs text-muted">{tool.description}</p>
                        </div>
                      </div>
                    )}
                    {dropZone(false)}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            {busy && (
              <p className="flex items-center justify-center gap-2 text-sm text-muted" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {busy}…
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="pdf-workspace"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
          >
            <div className="min-w-0 space-y-4">
              <PdfBar />
              <PageGrid />
              {dropZone(true)}
            </div>
            <div className="lg:sticky lg:top-20">
              {variant === 'merge' ? <MergePanel /> : <PdfPanel initialTab={picked ?? 'save'} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
