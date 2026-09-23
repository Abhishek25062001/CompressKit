import { motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { Button } from '../common/Button';
import { FILE_INPUT_ID } from '../upload/DropZone';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.08 * i, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } }),
};

export function Hero() {
  const start = () => {
    document.getElementById('compress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById(FILE_INPUT_ID)?.click();
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
          Reduce file sizes while preserving visual quality. Everything happens directly in your browser.
        </motion.p>
        <motion.div
          custom={3}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-8 flex flex-col items-center gap-3"
        >
          <Button variant="primary" size="lg" onClick={start} icon={<ArrowDown className="h-4 w-4" />}>
            Start Compressing
          </Button>
          <p className="text-sm text-muted">No uploads • No account • Free</p>
        </motion.div>
      </div>
    </section>
  );
}
