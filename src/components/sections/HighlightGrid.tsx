import { motion } from 'framer-motion';
import type { Highlight } from '../../features/toolContent';
import { cn } from '../../utils/cn';
import { SectionHeading } from './SectionHeading';

interface HighlightGridProps {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  items: Highlight[];
}

/** Cards with an icon, a title and a sentence: what makes the product, or one tool, worth using. */
export function HighlightGrid({ id, eyebrow, title, description, items }: HighlightGridProps) {
  const titleId = `${id}-title`;
  return (
    <section aria-labelledby={titleId} id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24">
      <SectionHeading id={titleId} eyebrow={eyebrow} title={title} description={description} />
      {/* Two or four items read best in two columns; three or six in three. */}
      <ul className={cn('grid gap-4 sm:grid-cols-2', items.length % 3 === 0 && 'lg:grid-cols-3')}>
        {items.map((f, i) => (
          <motion.li
            key={f.title}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ delay: (i % 3) * 0.06, duration: 0.45 }}
            className="card group p-6 transition-colors hover:border-border-strong"
          >
            <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
              <f.icon className="h-5 w-5" aria-hidden />
            </span>
            <h3 className="font-semibold text-fg">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.body}</p>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
