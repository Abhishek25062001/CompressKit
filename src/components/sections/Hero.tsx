import { motion } from 'framer-motion';
import { ArrowDown, Search } from 'lucide-react';
import { FEATURES, POPULAR_FEATURES } from '../../features/directory';
import { useUiStore } from '../../store/uiStore';
import { cn } from '../../utils/cn';
import { IN_NATIVE_APP } from '../../utils/nativeApp';
import { TOOLS_SHORTCUT } from '../../utils/shortcut';
// import { Link } from '../common/Link';
// import { hue } from '../tools/hue';

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.08 * i, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } }),
};

export function Hero() {
  const openTools = useUiStore((s) => s.openTools);
  return (
    <section id="top" className="relative overflow-hidden">
      {!IN_NATIVE_APP && (
        <>
          <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
          <div
            className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-40 blur-3xl dark:opacity-25"
            style={{ background: 'radial-gradient(closest-side, var(--accent-soft), transparent)' }}
            aria-hidden
          />
        </>
      )}
      <div
        className={cn(
          'relative mx-auto max-w-4xl px-4 text-center sm:px-6',
          IN_NATIVE_APP ? 'pt-4 pb-2' : 'pt-6 pb-1 sm:pt-8 sm:pb-2',
        )}
      >
        {!IN_NATIVE_APP && (
          <>
            <motion.p
              custom={0}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface/80 px-3 py-1 text-xs font-medium text-muted backdrop-blur"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              {FEATURES.length} private file tools · Nothing is uploaded · No account · Free · Works offline
            </motion.p>
            {/* <motion.h1
              custom={1}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="text-[2.2rem] leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg sm:text-6xl"
            >
              Everyday file tools{' '}
              <span className="bg-gradient-to-r from-accent-text to-accent-2 bg-clip-text text-transparent">
                that never upload your files.
              </span>
            </motion.h1> */}
            {/* <motion.p
              custom={2}
              variants={fadeUp}
              initial="hidden"
              animate="show"
              className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted sm:text-lg"
            >
              Compress, convert, resize and trim photos and videos. Merge, split, sign, edit and convert PDFs, Word, Excel
              and PowerPoint files. Everything runs right here in your browser.
            </motion.p> */}
          </>
        )}
        {/* <motion.div
          custom={IN_NATIVE_APP ? 0 : 3}
          variants={fadeUp}
          initial="hidden"
          animate="show"
          className={cn('mx-auto max-w-3xl', IN_NATIVE_APP ? 'mt-0' : 'mt-8')}
        > */}
          {/* <button
            type="button"
            onClick={() => openTools(true)}
            aria-haspopup="dialog"
            className="group mx-auto flex h-13 w-full max-w-xl items-center gap-3 rounded-2xl border border-border bg-surface px-4 text-left shadow-[var(--shadow-soft)] transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[var(--shadow-lift)]"
          >
            <Search className="h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-accent-text" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[15px] text-subtle">
              Search {FEATURES.length} tools
              {!IN_NATIVE_APP && <span className="hidden sm:inline">, like “PDF to Word” or “passport”</span>}
            </span>
            {!IN_NATIVE_APP && (
              <kbd
                className="hidden shrink-0 rounded-md border border-border bg-surface-2 px-2 py-0.5 font-sans text-xs text-muted sm:inline"
                aria-hidden
              >
                {TOOLS_SHORTCUT}
              </kbd>
            )}
          </button> */}
          {/* {!IN_NATIVE_APP && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs font-medium tracking-wide text-subtle uppercase">Popular</span>
              {POPULAR_FEATURES.map((f) => (
                <Link
                  key={f.key}
                  to={f.to}
                  style={hue(f.category)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 py-1 text-[13px] text-muted backdrop-blur transition-colors hover:border-(color:--hue)/60 hover:text-fg"
                >
                  <f.icon className="h-3.5 w-3.5 text-(color:--hue)" aria-hidden />
                  {f.name}
                </Link>
              ))}
            </div>
          )} */}
        {/* </motion.div> */}
        {/* {!IN_NATIVE_APP && (
          <motion.div
            custom={4}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            className="mt-7 flex flex-col items-center gap-2 text-sm text-muted sm:flex-row sm:justify-center sm:gap-2"
          >
            <Link to="/#tools" className="inline-flex items-center gap-1.5 rounded-lg font-medium text-accent-text hover:underline">
              Browse all tools by category <ArrowDown className="h-4 w-4" aria-hidden />
            </Link>
            <span className="hidden text-subtle sm:inline" aria-hidden>
              ·
            </span>
            <span>No account · Free · Works offline</span>
          </motion.div>
        )} */}
      </div>
    </section>
  );
}
