import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { addFiles } from '../../features/compression/intake';
import { useQueueSummary } from '../../hooks/useQueueSummary';
import { useQueueStore } from '../../store/queueStore';
import { CompressionBar } from '../compression/CompressionBar';
import { FileQueue } from '../files/FileQueue';
import { CompletionSummary } from '../results/CompletionSummary';
import { FileSettingsDialog } from '../settings/FileSettingsDialog';
import { SettingsPanel } from '../settings/SettingsPanel';
import { DropZone } from '../upload/DropZone';

export function Workspace() {
  const summary = useQueueSummary();
  const running = useQueueStore((s) => s.running);
  const finished = useQueueStore((s) => s.hasFinishedRun);
  const hasFiles = summary.total > 0;
  const showCompletion = finished && !running && summary.completed > 0 && summary.waiting === 0;

  // Paste images or videos from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <section id="compress" aria-label="Compressor" className="mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
      <AnimatePresence mode="popLayout" initial={false}>
        {!hasFiles ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="mx-auto max-w-3xl"
          >
            <DropZone />
          </motion.div>
        ) : (
          <motion.div
            key="workspace"
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
              <SettingsPanel defaultTab={summary.images === 0 && summary.videos > 0 ? 'video' : 'image'} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <FileSettingsDialog />
    </section>
  );
}
