import { AnimatePresence, motion } from 'framer-motion';
import { lazy, Suspense, useEffect } from 'react';
import { TOOL_BY_ID, type ToolId } from '../../features/catalog';
import { TOOLS, ToolContext } from '../../features/tools';
import { useQueueSummary } from '../../hooks/useQueueSummary';
import { isConvertKind } from '../../store/docsStore';
import type { ToolMode } from '../../types/media';
import { CompressionBar } from '../compression/CompressionBar';
import { FileQueue } from '../files/FileQueue';
import { CropDialog } from '../resize/CropDialog';
import { CompletionSummary } from '../results/CompletionSummary';
import { CleanInfoPanel } from '../settings/CleanInfoPanel';
import { ConvertSettingsPanel } from '../settings/ConvertSettingsPanel';
import { FileSettingsDialog } from '../settings/FileSettingsDialog';
import { ResizeSettingsPanel } from '../settings/ResizeSettingsPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { DropZone } from '../upload/DropZone';

const PdfWorkspace = lazy(() => import('../pdf/PdfWorkspace').then((m) => ({ default: m.PdfWorkspace })));
const ConvertWorkspace = lazy(() => import('../docs/ConvertWorkspace').then((m) => ({ default: m.ConvertWorkspace })));
const DocxEditor = lazy(() => import('../docs/DocxEditor').then((m) => ({ default: m.DocxEditor })));
const TrimWorkspace = lazy(() => import('../trim/TrimWorkspace').then((m) => ({ default: m.TrimWorkspace })));
const BackgroundSettingsPanel = lazy(() => import('../settings/BackgroundSettingsPanel').then((m) => ({ default: m.BackgroundSettingsPanel })));

function ToolFallback() {
  return (
    <div className="mx-auto h-48 max-w-3xl animate-pulse rounded-3xl border-2 border-dashed border-border bg-surface/70" role="status" aria-label="Loading tool" />
  );
}

function ToolPanel({ mode }: { mode: ToolMode }) {
  const tool = TOOLS[mode];
  const summary = useQueueSummary();
  const running = tool.useQueue((s) => s.running);
  const finished = tool.useQueue((s) => s.hasFinishedRun);
  const hasFiles = summary.total > 0;
  const showCompletion = finished && !running && summary.completed > 0 && summary.waiting === 0;
  const defaultTab = summary.images === 0 && summary.videos > 0 ? 'video' : 'image';

  // Paste images or videos from the clipboard anywhere on the page, into the tool on screen.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        tool.addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [tool]);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {!hasFiles ? (
        <motion.div
          key={`${mode}-empty`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mx-auto max-w-3xl"
        >
          <DropZone />
        </motion.div>
      ) : (
        <motion.div
          key={`${mode}-workspace`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
        >
          <div className="min-w-0 space-y-4">
            {showCompletion && <CompletionSummary />}
            <div className="card p-4">
              <CompressionBar />
            </div>
            <FileQueue />
            <DropZone compact />
          </div>
          <div className="lg:sticky lg:top-20">
            {mode === 'compress' ? (
              <SettingsPanel defaultTab={defaultTab} />
            ) : mode === 'convert' ? (
              <ConvertSettingsPanel defaultTab={defaultTab} />
            ) : mode === 'clean' ? (
              <CleanInfoPanel />
            ) : mode === 'background' ? (
              <Suspense fallback={<ToolFallback />}>
                <BackgroundSettingsPanel />
              </Suspense>
            ) : (
              <ResizeSettingsPanel />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The tool itself, as shown on its page: the drop zone and, once files are added, its queue and settings. */
export function ToolWorkspace({ id }: { id: ToolId }) {
  return (
    <section id="tool" aria-label={TOOL_BY_ID[id].name} className="mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
      <Suspense fallback={<ToolFallback />}>
        {id === 'pdf' || id === 'edit-pdf' || id === 'merge' ? (
          <PdfWorkspace variant={id === 'pdf' ? 'pdf' : id === 'edit-pdf' ? 'edit' : 'merge'} />
        ) : isConvertKind(id) ? (
          <ConvertWorkspace kind={id} />
        ) : id === 'edit-docx' ? (
          <DocxEditor />
        ) : id === 'trim' ? (
          <TrimWorkspace />
        ) : (
          <ToolContext value={TOOLS[id]}>
            <ToolPanel mode={id} />
          </ToolContext>
        )}
      </Suspense>
      <FileSettingsDialog />
      <CropDialog />
    </section>
  );
}
