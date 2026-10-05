import { ArrowUpRight, LayoutGrid } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { CATEGORIES, FEATURES, FEATURES_BY_CATEGORY, type CategoryId, type Feature } from '../../features/directory';
import { cn } from '../../utils/cn';
import { IN_NATIVE_APP } from '../../utils/nativeApp';
import { Link } from '../common/Link';
import { SectionHeading } from '../sections/SectionHeading';
import { hue } from './hue';
import { TILE_GRID, ToolTile } from './ToolTile';

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <Link
      to={feature.to}
      style={hue(feature.category)}
      className="card group flex h-full items-start gap-3.5 p-4 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-(color:--hue)/50 hover:shadow-[var(--shadow-lift)]"
    >
      <span className="hue-tile inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <feature.icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="font-semibold text-fg">{feature.name}</span>
          <ArrowUpRight
            className="mt-0.5 h-4 w-4 shrink-0 text-subtle transition-[color,transform] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-(color:--hue)"
            aria-hidden
          />
        </span>
        <span className="mt-1 block text-sm leading-snug text-muted">{feature.description}</span>
      </span>
    </Link>
  );
}

function Chip({ active, onClick, count, children, id }: { active: boolean; onClick: () => void; count: number; children: ReactNode; id: CategoryId | 'all' }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={id === 'all' ? undefined : hue(id)}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
        active ? 'border-fg bg-fg text-bg' : 'border-border bg-surface text-muted hover:border-border-strong hover:text-fg',
      )}
    >
      {children}
      <span className={cn('text-xs tabular', active ? 'opacity-70' : 'text-subtle')}>{count}</span>
    </button>
  );
}

/**
 * Every tool on the home page, grouped by category, with chips that narrow the list to one
 * category. The same list as the header's launcher, with a line on what each tool does.
 *
 * In the phone app the tools are small tiles instead, three to a row, so the whole list fits in
 * a few screens; the website keeps its cards.
 */
export function ToolDirectory() {
  const [filter, setFilter] = useState<CategoryId | 'all'>('all');
  const listRef = useRef<HTMLDivElement>(null);
  const groups = filter === 'all' ? FEATURES_BY_CATEGORY : FEATURES_BY_CATEGORY.filter((g) => g.category.id === filter);

  const choose = (id: CategoryId | 'all') => {
    setFilter(id);
    // After scrolling down a long list, start the shorter one from its top, right under the chips.
    if ((listRef.current?.getBoundingClientRect().top ?? 0) < 0) {
      requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  };

  return (
    <section aria-labelledby="tools-title" id="tools" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        id="tools-title"
        eyebrow="All tools"
        title={`${FEATURES.length} tools, sorted by what you're working on`}
        description={
          IN_NATIVE_APP
            ? 'Pick a category or scroll through them all. Each one runs on this phone, works without a connection, and never uploads your files.'
            : 'Pick a category or scroll through them all. Each one runs entirely in your browser, works offline after your first visit, and never uploads your files.'
        }
      />
      <div className="sticky top-16 z-30 -mx-4 mb-8 border-b border-border/60 bg-bg/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div role="group" aria-label="Show tools for" className="no-scrollbar -my-1 flex gap-2 overflow-x-auto py-1 lg:flex-wrap lg:justify-center">
          <Chip id="all" active={filter === 'all'} onClick={() => choose('all')} count={FEATURES.length}>
            <LayoutGrid className="h-4 w-4" aria-hidden />
            All
          </Chip>
          {CATEGORIES.map((c) => (
            <Chip key={c.id} id={c.id} active={filter === c.id} onClick={() => choose(c.id)} count={FEATURES_BY_CATEGORY.find((g) => g.category.id === c.id)!.features.length}>
              <c.icon className={cn('h-4 w-4', filter !== c.id && 'text-(color:--hue)')} aria-hidden />
              {c.name}
            </Chip>
          ))}
        </div>
      </div>
      <div ref={listRef} className={cn('scroll-mt-36', IN_NATIVE_APP ? 'space-y-8' : 'space-y-12 sm:space-y-14')}>
        {groups.map(({ category, features }) => (
          <section key={category.id} aria-labelledby={`tools-${category.id}`} style={hue(category.id)}>
            {IN_NATIVE_APP ? (
              <div className="mb-3 flex items-center gap-2.5">
                <span className="hue-tile inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                  <category.icon className="h-4 w-4" aria-hidden />
                </span>
                <h3 id={`tools-${category.id}`} className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-fg">
                  {category.name}
                  <span className="text-sm font-normal text-subtle tabular">{features.length}</span>
                </h3>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-3 sm:mb-5">
                <span className="hue-tile inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                  <category.icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 id={`tools-${category.id}`} className="flex items-baseline gap-2 text-lg font-semibold tracking-tight text-fg">
                    {category.name}
                    <span className="text-sm font-normal text-subtle tabular">{features.length}</span>
                  </h3>
                  <p className="text-sm text-muted">{category.description}</p>
                </div>
              </div>
            )}
            <ul className={IN_NATIVE_APP ? TILE_GRID : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'}>
              {features.map((f) => (
                <li key={f.key}>{IN_NATIVE_APP ? <ToolTile feature={f} /> : <FeatureCard feature={f} />}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
