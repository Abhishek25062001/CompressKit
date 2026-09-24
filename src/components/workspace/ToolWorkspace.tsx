import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { TOOL_BY_ID, type ToolId } from '../../features/catalog';
import { TOOLS, ToolContext } from '../../features/tools';
import { useQueueSummary } from '../../hooks/useQueueSummary';
import type { ToolMode } from '../../types/media';
import { PdfWorkspace } from '../pdf/PdfWorkspace';
import { CompressionBar } from '../compression/CompressionBar';
import { FileQueue } from '../files/FileQueue';
import { CropDialog } from '../resize/CropDialog';
import { CompletionSummary } from '../results/CompletionSummary';
import { BackgroundSettingsPanel } from '../settings/BackgroundSettingsPanel';
import { CleanInfoPanel } from '../settings/CleanInfoPanel';
import { ConvertSettingsPanel } from '../settings/ConvertSettingsPanel';
import { FileSettingsDialog } from '../settings/FileSettingsDialog';
import { ResizeSettingsPanel } from '../settings/ResizeSettingsPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { TrimWorkspace } from '../trim/TrimWorkspace';
import { DropZone } from '../upload/DropZone';

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
              <BackgroundSettingsPanel />
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
      {id === 'pdf' ? (
        <PdfWorkspace />
      ) : id === 'trim' ? (
        <TrimWorkspace />
      ) : (
        <ToolContext value={TOOLS[id]}>
          <ToolPanel mode={id} />
        </ToolContext>
      )}
      <FileSettingsDialog />
      <CropDialog />
    </section>
  );
}
