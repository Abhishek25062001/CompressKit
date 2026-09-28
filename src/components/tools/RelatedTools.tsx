import { CATALOG, type ToolId } from '../../features/catalog';
import { ToolCard } from './ToolCard';

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
