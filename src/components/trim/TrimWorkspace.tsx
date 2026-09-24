import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';
import { acceptAttribute } from '../../constants/formats';
import { fileInputId } from '../../features/tools';
import { TRIM_BADGES, TRIM_INPUT_FORMATS, loadTrimFile } from '../../features/trim/trimJob';
import { useTrimStore } from '../../store/trimStore';
import { FileDropZone } from '../upload/DropZone';
import { TrimEditor } from './TrimEditor';
import { TrimPanel } from './TrimPanel';
import { TrimResults } from './TrimResults';

const ACCEPT = acceptAttribute(TRIM_INPUT_FORMATS);

export function TrimWorkspace() {
  const hasSource = useTrimStore((s) => s.source !== null);
  const loading = useTrimStore((s) => s.loading);
  const onFiles = (files: FileList) => void loadTrimFile(Array.from(files));

  // Paste a video anywhere on the page while the trimmer is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      const files = e.clipboardData?.files;
      if (files?.length) {
        e.preventDefault();
        void loadTrimFile(Array.from(files));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {!hasSource ? (
        <motion.div
          key="trim-empty"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mx-auto max-w-3xl space-y-3"
        >
          <FileDropZone inputId={fileInputId('trim')} accept={ACCEPT} badges={TRIM_BADGES} onFiles={onFiles} />
          {loading && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading video…
            </p>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="trim-workspace"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          // On phones the settings (with the start button) come right after the editor, before the results.
          className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-x-6"
        >
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <TrimEditor />
          </div>
          <div className="lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <TrimPanel />
          </div>
          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <TrimResults />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
