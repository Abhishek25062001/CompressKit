import { motion } from 'framer-motion';
import { SectionHeading } from './SectionHeading';

interface StepListProps {
  id: string;
  eyebrow: string;
  title: string;
  /** Title and one sentence per step. */
  steps: [string, string][];
}

export function StepList({ id, eyebrow, title, steps }: StepListProps) {
  const titleId = `${id}-title`;
  return (
    <section aria-labelledby={titleId} id={id} className="scroll-mt-20 border-y border-border bg-surface/50">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <SectionHeading id={titleId} eyebrow={eyebrow} title={title} />
        <ol className="relative grid gap-8 md:grid-cols-3 md:gap-6">
          <div
            className="absolute top-8 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent via-border-strong to-transparent md:block"
            aria-hidden
          />
          {steps.map(([stepTitle, body], i) => {
            const n = String(i + 1).padStart(2, '0');
            return (
              <motion.li
                key={stepTitle}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ delay: i * 0.1, duration: 0.45 }}
                className="relative text-center"
              >
                <span aria-hidden className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface font-mono text-lg font-medium text-accent-text shadow-[var(--shadow-soft)]">
                  {n}
                </span>
                <h3 className="text-lg font-semibold text-fg">
                  <span className="sr-only">Step {i + 1}: </span>
                  {stepTitle}
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-sm text-muted">{body}</p>
              </motion.li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
