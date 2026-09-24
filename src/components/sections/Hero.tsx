import { motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';
import { Link } from '../common/Link';
import { SmartDrop } from '../tools/SmartDrop';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.08 * i, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } }),
};

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-40 blur-3xl dark:opacity-25"
        style={{ background: 'radial-gradient(closest-side, var(--accent-soft), transparent)' }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-4xl px-4 pt-14 pb-10 text-center sm:px-6 sm:pt-20 sm:pb-14">
        <motion.p
          custom={0}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted backdrop-blur"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          Private file tools · Nothing is uploaded
        </motion.p>
        <motion.h1
          custom={1}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="text-[2.2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg sm:text-6xl"
        >
          Everyday file tools{' '}
          <span className="bg-gradient-to-r from-accent-text to-accent-2 bg-clip-text text-transparent">that never upload your files.</span>
        </motion.h1>
        <motion.p
          custom={2}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted sm:text-lg"
        >
          Compress, convert, resize and trim photos and videos, remove backgrounds and hidden location data, and work with PDFs.
          Everything runs right here in your browser.
        </motion.p>
        <motion.div custom={3} variants={fadeUp} initial="hidden" animate="show" className="mx-auto mt-8 max-w-2xl">
          {/* <SmartDrop /> */}
        </motion.div>
        <motion.div
          custom={4}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className="mt-6 flex flex-col items-center gap-2 text-sm text-muted sm:flex-row sm:justify-center sm:gap-2"
        >
          <Link to="/#tools" className="inline-flex items-center gap-1.5 rounded-lg font-medium text-accent-text hover:underline">
            Choose tools <ArrowDown className="h-4 w-4" aria-hidden />
          </Link>
          <span className="hidden text-subtle sm:inline" aria-hidden>
            ·
          </span>
          <span>No account · Free · Works offline</span>
        </motion.div>
      </div>
    </section>
  );
}
