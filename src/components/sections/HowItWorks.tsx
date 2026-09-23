import { motion } from 'framer-motion';
import { SectionHeading } from './SectionHeading';

const STEPS = [
  { n: '01', title: 'Select', body: 'Choose your images or videos.' },
  { n: '02', title: 'Compress', body: 'Pick your quality level and let your browser process the files.' },
  { n: '03', title: 'Download', body: 'Download your optimized files instantly.' },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" id="how-it-works" className="border-y border-border bg-surface/50">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <SectionHeading id="how-title" eyebrow="How it works" title="Three steps. No detours." />
        <ol className="relative grid gap-4 md:grid-cols-3 md:gap-6">
          <div
            className="absolute top-8 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-border-strong to-transparent md:block"
            aria-hidden
          />
          {STEPS.map((s, i) => (
            <motion.li
              key={s.n}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ delay: i * 0.1, duration: 0.45 }}
              className="relative text-center"
            >
              <span aria-hidden className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface font-mono text-lg font-medium text-accent-text shadow-[var(--shadow-soft)]">
                {s.n}
              </span>
              <h3 className="text-lg font-semibold text-fg">
                <span className="sr-only">{s.n} — </span>
                {s.title}
              </h3>
              <p className="mx-auto mt-2 max-w-xs text-sm text-muted">{s.body}</p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
