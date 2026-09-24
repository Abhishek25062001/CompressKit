import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftRight, Crop, FileText, Scissors, Shrink } from 'lucide-react';
import { useEffect } from 'react';
import { TOOLS, ToolContext } from '../../features/tools';
import { useQueueSummary } from '../../hooks/useQueueSummary';
import { toolFromHash, useUiStore } from '../../store/uiStore';
import type { ToolMode, WorkspaceTab } from '../../types/media';
import { SegmentedControl } from '../common/SegmentedControl';
import { PdfWorkspace } from '../pdf/PdfWorkspace';
import { CompressionBar } from '../compression/CompressionBar';
import { FileQueue } from '../files/FileQueue';
import { CropDialog } from '../resize/CropDialog';
import { CompletionSummary } from '../results/CompletionSummary';
import { ConvertSettingsPanel } from '../settings/ConvertSettingsPanel';
import { FileSettingsDialog } from '../settings/FileSettingsDialog';
import { ResizeSettingsPanel } from '../settings/ResizeSettingsPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { TrimWorkspace } from '../trim/TrimWorkspace';
import { DropZone } from '../upload/DropZone';

const TOOL_INTRO: Record<WorkspaceTab, string> = {
  compress: 'Make images and videos smaller while keeping them looking the same.',
  convert: 'Change file formats: images to JPG, PNG, WebP or AVIF, and videos to MP4, WebM, GIF or audio.',
  resize: 'Crop and resize photos to exact sizes: passport photos, signatures, profile pictures, posts and thumbnails.',
  trim: 'Cut a video down to the part you want, or split it into 60-second parts for WhatsApp Status.',
  pdf: 'Turn photos into a PDF, merge PDFs, reorder, rotate or remove pages, split files, or save pages as images.',
};

const SECTION_LABEL: Record<WorkspaceTab, string> = {
  compress: 'Compressor',
  convert: 'Converter',
  resize: 'Photo resizer',
  trim: 'Video trimmer',
  pdf: 'PDF tools',
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
            {mode === 'compress' ? (
              <SettingsPanel defaultTab={defaultTab} />
            ) : mode === 'convert' ? (
              <ConvertSettingsPanel defaultTab={defaultTab} />
            ) : (
              <ResizeSettingsPanel />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Workspace() {
  const active = useUiStore((s) => s.activeTool);
  const setActive = useUiStore((s) => s.setActiveTool);

  // Shared "#convert", "#resize", "#trim" and "#pdf" links open those tools; there are no elements with those ids to scroll to.
  useEffect(() => {
    const open = () => {
      const tool = toolFromHash();
      if (tool === 'compress') return;
      setActive(tool);
      document.getElementById('compress')?.scrollIntoView({ block: 'start' });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [setActive]);

  return (
    <section id="compress" aria-label={SECTION_LABEL[active]} className="mx-auto max-w-6xl scroll-mt-20 px-4 sm:px-6">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <SegmentedControl
          label="Tool"
          value={active}
          onChange={setActive}
          segments={[
            // Icons hide on phones so all five tabs fit on one line.
            { value: 'compress', label: <><Shrink className="hidden h-4 w-4 sm:block" aria-hidden /> Compress</> },
            { value: 'convert', label: <><ArrowLeftRight className="hidden h-4 w-4 sm:block" aria-hidden /> Convert</> },
            { value: 'resize', label: <><Crop className="hidden h-4 w-4 sm:block" aria-hidden /> Resize</> },
            { value: 'trim', label: <><Scissors className="hidden h-4 w-4 sm:block" aria-hidden /> Trim</> },
            { value: 'pdf', label: <><FileText className="hidden h-4 w-4 sm:block" aria-hidden /> PDF</> },
          ]}
        />
        <p className="max-w-xl text-sm text-muted">{TOOL_INTRO[active]}</p>
      </div>
      {active === 'pdf' ? (
        <PdfWorkspace />
      ) : active === 'trim' ? (
        <TrimWorkspace />
      ) : (
        <ToolContext value={TOOLS[active]}>
          <ToolPanel key={active} mode={active} />
        </ToolContext>
      )}
      <FileSettingsDialog />
      <CropDialog />
    </section>
  );
}
