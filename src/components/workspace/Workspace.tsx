import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftRight, Shrink } from 'lucide-react';
import { useEffect } from 'react';
import { TOOLS, ToolContext } from '../../features/tools';
import { useQueueSummary } from '../../hooks/useQueueSummary';
import { useUiStore } from '../../store/uiStore';
import type { ToolMode } from '../../types/media';
import { SegmentedControl } from '../common/SegmentedControl';
import { CompressionBar } from '../compression/CompressionBar';
import { FileQueue } from '../files/FileQueue';
import { CompletionSummary } from '../results/CompletionSummary';
import { ConvertSettingsPanel } from '../settings/ConvertSettingsPanel';
import { FileSettingsDialog } from '../settings/FileSettingsDialog';
import { SettingsPanel } from '../settings/SettingsPanel';
import { DropZone } from '../upload/DropZone';

const TOOL_INTRO: Record<ToolMode, string> = {
  compress: 'Make images and videos smaller while keeping them looking the same.',
  convert: 'Change file formats: images to JPG, PNG, WebP or AVIF, and videos to MP4, WebM, GIF or audio.',
};

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
            {mode === 'compress' ? <SettingsPanel defaultTab={defaultTab} /> : <ConvertSettingsPanel defaultTab={defaultTab} />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Workspace() {
  const active = useUiStore((s) => s.activeTool);
  const setActive = useUiStore((s) => s.setActiveTool);

  // A shared "#convert" link opens the converter; there is no element with that id to scroll to.
  useEffect(() => {
    const open = () => {
      if (window.location.hash !== '#convert') return;
      setActive('convert');
      document.getElementById('compress')?.scrollIntoView({ block: 'start' });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [setActive]);

  return (
    <section id="compress" aria-label={active === 'compress' ? 'Compressor' : 'Converter'} className="mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <SegmentedControl
          label="Tool"
          value={active}
          onChange={setActive}
          segments={[
            { value: 'compress', label: <><Shrink className="h-4 w-4" aria-hidden /> Compress</> },
            { value: 'convert', label: <><ArrowLeftRight className="h-4 w-4" aria-hidden /> Convert</> },
          ]}
        />
        <p className="max-w-xl text-sm text-muted">{TOOL_INTRO[active]}</p>
      </div>
      <ToolContext value={TOOLS[active]}>
        <ToolPanel key={active} mode={active} />
      </ToolContext>
      <FileSettingsDialog />
    </section>
  );
}
