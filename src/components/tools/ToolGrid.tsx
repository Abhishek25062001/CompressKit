import { CATALOG, type ToolId } from '../../features/catalog';
import { SectionHeading } from '../sections/SectionHeading';
import { ToolCard } from './ToolCard';

/**
 * Some tools get wide cards so that twelve tools fill every row: 2 + 1, 3, 1 + 2, 2 + 1, 3 in
 * three columns, and pairs with PDF tools and Edit Word document spanning the row in two.
 */
const WIDE: Partial<Record<ToolId, { span: string; highlights: string }>> = {
  compress: { span: 'lg:col-span-2', highlights: 'lg:flex' },
  pdf: { span: 'sm:col-span-2', highlights: 'sm:flex' },
  'edit-pdf': { span: 'lg:col-span-2', highlights: 'lg:flex' },
  'edit-docx': { span: 'sm:col-span-2 lg:col-span-1', highlights: 'sm:flex lg:hidden' },
};

export function ToolGrid() {
  return (
    <section aria-labelledby="tools-title" id="tools" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        id="tools-title"
        eyebrow="Tools"
        title="Pick a tool"
        description="Each one runs entirely in your browser, works offline after your first visit, and never uploads your files."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOG.map((tool) => (
          <li key={tool.id} className={WIDE[tool.id]?.span}>
            <ToolCard tool={tool} highlightsFrom={WIDE[tool.id]?.highlights} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Other tools that open the same kinds of file, for the bottom of a tool page. */
export function RelatedTools({ id }: { id: ToolId }) {
  const current = CATALOG.find((t) => t.id === id)!;
  const related = CATALOG.filter((t) => t.id !== id)
    .map((t) => ({ t, shared: t.handles.filter((k) => current.handles.includes(k)).length }))
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 3)
    .map(({ t }) => t);
  return (
    <section aria-labelledby="related-title" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-20">
      <h2 id="related-title" className="mb-5 text-xl font-semibold tracking-tight text-fg">
        More tools for your files
      </h2>
      <ul className="grid gap-4 sm:grid-cols-3">
        {related.map((tool) => (
          <li key={tool.id}>
            <ToolCard tool={tool} />
          </li>
        ))}
      </ul>
    </section>
  );
}
