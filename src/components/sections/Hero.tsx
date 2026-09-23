import { motion } from 'framer-motion';
import { ArrowDown, ArrowLeftRight, Crop, FileText } from 'lucide-react';
import { flushSync } from 'react-dom';
import { fileInputId } from '../../features/tools';
import { useUiStore } from '../../store/uiStore';
import type { WorkspaceTab } from '../../types/media';
import { Button } from '../common/Button';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.08 * i, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } }),
};

export function Hero() {
  const start = (tool: WorkspaceTab) => {
    // Render the chosen tool first so its file input exists before we open the picker.
    flushSync(() => useUiStore.getState().setActiveTool(tool));
    document.getElementById('compress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById(fileInputId(tool))?.click();
  };

  return (
    <section id="top" className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-40 blur-3xl dark:opacity-25"
        style={{ background: 'radial-gradient(closest-side, var(--accent-soft), transparent)' }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-4xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24 sm:pb-16">
        <motion.p
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted backdrop-blur"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          Compress your media. Keep your privacy.
        </motion.p>
        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="text-[2.2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg sm:text-6xl"
        >
          Compress your images &amp; videos{' '}
          <span className="bg-gradient-to-r from-accent-text to-accent-2 bg-clip-text text-transparent">without the hassle.</span>
        </motion.h1>
        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted sm:text-lg"
        >
          Reduce file sizes while preserving visual quality, convert between formats, crop photos to exact sizes, or build and split PDFs. Everything happens directly in your browser.
        </motion.p>
        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-8 flex flex-col items-center gap-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" size="lg" onClick={() => start('compress')} icon={<ArrowDown className="h-4 w-4" />}>
              Start Compressing
            </Button>
            <Button size="lg" onClick={() => start('convert')} icon={<ArrowLeftRight className="h-4 w-4" />}>
              Convert Files
            </Button>
            <Button size="lg" onClick={() => start('resize')} icon={<Crop className="h-4 w-4" />}>
              Resize Photos
            </Button>
            <Button size="lg" onClick={() => start('pdf')} icon={<FileText className="h-4 w-4" />}>
              PDF Tools
            </Button>
          </div>
          <p className="text-sm text-muted">No uploads • No account • Free</p>
        </motion.div>
      </div>
    </section>
  );
}
