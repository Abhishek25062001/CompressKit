import { ArrowUpRight, LayoutGrid } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { CATEGORIES, FEATURES, FEATURES_BY_CATEGORY, type CategoryId, type Feature } from '../../features/directory';
import { cn } from '../../utils/cn';
import { IN_NATIVE_APP } from '../../utils/nativeApp';
import { Link } from '../common/Link';
import { hue } from './hue';
import { ToolTile } from './ToolTile';

/* ---------------------------------- Card ---------------------------------- */

function FeatureCard({ feature }: { feature: Feature }) {
  return (
    <Link
      to={feature.to}
      style={hue(feature.category)}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface',
        // Compact on phones, roomier as the viewport grows
        'p-3 sm:p-4 lg:p-5',
        'rounded-xl sm:rounded-2xl',
        'transition-[transform,border-color,box-shadow] duration-300 ease-out will-change-transform',
        'hover:-translate-y-1 hover:border-(color:--hue)/40',
        'hover:shadow-[0_20px_40px_-24px_var(--hue)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(color:--hue)/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-30 sm:h-28 sm:w-28"
        style={{ background: 'var(--hue)' }}
      />

      {/* Icon + arrow row */}
      <div className="relative flex items-start justify-between gap-2">
        <span
          className={cn(
            'hue-tile inline-flex shrink-0 items-center justify-center rounded-lg sm:rounded-xl',
            'h-9 w-9 sm:h-10 sm:w-10 lg:h-11 lg:w-11',
            'transition-transform duration-300 group-hover:scale-105',
          )}
        >
          <feature.icon className="h-4 w-4 sm:h-4.5 sm:w-4.5 lg:h-5 lg:w-5" aria-hidden />
        </span>
        <ArrowUpRight
          aria-hidden
          className={cn(
            'shrink-0 text-subtle transition-[transform,color] duration-300',
            'h-3.5 w-3.5 sm:h-4 sm:w-4',
            'group-hover:-translate-y-1 group-hover:translate-x-1 group-hover:text-(color:--hue)',
          )}
        />
      </div>

      {/* Title + description */}
      <div className="relative mt-3 min-w-0 flex-1 sm:mt-4">
        <h4
          className={cn(
            'font-semibold tracking-tight text-fg',
            // Slightly smaller on phones so long names still fit 2-up
            'text-[13px] leading-snug sm:text-sm lg:text-base',
          )}
        >
          {feature.name}
        </h4>
        <p
          className={cn(
            'mt-1 line-clamp-2 text-muted sm:mt-1.5',
            'text-[11px] leading-snug sm:text-xs sm:leading-relaxed lg:text-sm',
          )}
        >
          {feature.description}
        </p>
      </div>

      {/* Bottom accent */}
      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-0.5 w-0 bg-(color:--hue) transition-[width] duration-300 ease-out group-hover:w-full"
      />
    </Link>
  );
}

/* ---------------------------------- Chip ---------------------------------- */

function Chip({
  id,
  active,
  count,
  onClick,
  children,
}: {
  id: CategoryId | 'all';
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={id === 'all' ? undefined : hue(id)}
      className={cn(
        'group/chip relative inline-flex shrink-0 items-center gap-2 rounded-full border whitespace-nowrap',
        'h-9 px-3 text-[13px] sm:h-10 sm:px-4 sm:text-sm',
        'font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(color:--hue)/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        active
          ? 'border-fg bg-fg text-bg shadow-sm'
          : 'border-border bg-surface text-muted hover:-translate-y-0.5 hover:border-border-strong hover:text-fg hover:shadow-sm',
      )}
    >
      {children}
      <span
        className={cn(
          'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
          active ? 'bg-bg/20 text-bg' : 'bg-subtle/10 text-subtle group-hover/chip:bg-subtle/20',
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function ToolDirectory() {
  const [filter, setFilter] = useState<CategoryId | 'all'>('all');
  const listRef = useRef<HTMLDivElement>(null);

  const countByCategory = useMemo(() => {
    const map = new Map<CategoryId, number>();
    for (const { category, features } of FEATURES_BY_CATEGORY) map.set(category.id, features.length);
    return map;
  }, []);

  const groups = useMemo(
    () =>
      filter === 'all'
        ? FEATURES_BY_CATEGORY
        : FEATURES_BY_CATEGORY.filter((g) => g.category.id === filter),
    [filter],
  );

  const choose = (id: CategoryId | 'all') => {
    if (id === filter) return;
    setFilter(id);
    if ((listRef.current?.getBoundingClientRect().top ?? 0) < 0) {
      requestAnimationFrame(() =>
        listRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      );
    }
  };

  const gridClass = IN_NATIVE_APP
    ? 'grid grid-cols-2 gap-3'
    : 'grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3 lg:gap-4';

  return (
    <section
      id="tools"
      aria-labelledby="tools-title"
      className={cn(
        'relative mx-auto w-full max-w-6xl scroll-mt-20 px-4 sm:px-6',
        IN_NATIVE_APP ? 'py-2' : 'pt-2 pb-6 sm:pt-3 sm:pb-8',
      )}
    >
      {/* {IN_NATIVE_APP ? (
        <h2 id="tools-title" className="sr-only">
          All tools
        </h2>
      ) : (
        <SectionHeading
          id="tools-title"
          eyebrow={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              All tools
            </span>
          }
          title={`${FEATURES.length} tools, sorted by what you're working on`}
          description="Pick a category or scroll through them all. Each one runs entirely in your browser, works offline after your first visit, and never uploads your files."
        />
      )} */}

      {/* Sticky filter bar */}
      <div
        className={cn(
          'sticky z-30 -mx-4 border-b border-border/60 bg-bg/80 backdrop-blur-xl sm:-mx-6',
          IN_NATIVE_APP ? 'top-8 mb-5 px-4 py-2' : 'top-6 mb-8 px-4 py-3 sm:mb-10 sm:px-4',
        )}
      >
        <div
          role="group"
          aria-label="Show tools for"
          className="no-scrollbar -my-1 flex gap-2 overflow-x-auto py-1 lg:flex-wrap lg:justify-center"
        >
          <Chip
            id="all"
            active={filter === 'all'}
            onClick={() => choose('all')}
            count={FEATURES.length}
          >
            <LayoutGrid className="h-4 w-4" aria-hidden />
            All
          </Chip>

          {CATEGORIES.map((c) => {
            const isActive = filter === c.id;
            return (
              <Chip
                key={c.id}
                id={c.id}
                active={isActive}
                onClick={() => choose(c.id)}
                count={countByCategory.get(c.id) ?? 0}
              >
                <c.icon
                  aria-hidden
                  className={cn('h-4 w-4', !isActive && 'text-(color:--hue)')}
                />
                {c.name}
              </Chip>
              
            );
          })}
        </div>
      </div>

      {/* Groups */}
      <div
        ref={listRef}
        className={cn('scroll-mt-36', IN_NATIVE_APP ? 'space-y-6' : 'space-y-10 sm:space-y-14 lg:space-y-16')}
      >
        {groups.map(({ category, features }) => (
          <section
            key={category.id}
            aria-labelledby={`tools-${category.id}`}
            style={hue(category.id)}
          >
            {IN_NATIVE_APP ? (
              <div className="mb-3 flex items-center gap-2.5">
                <span className="hue-tile inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg">
                  <category.icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <h3
                  id={`tools-${category.id}`}
                  className="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight text-fg"
                >
                  {category.name}
                  <span className="text-xs font-normal text-subtle tabular-nums">
                    {features.length}
                  </span>
                </h3>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-3 sm:mb-6 sm:gap-4">
                <span className="hue-tile inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm sm:h-12 sm:w-12 sm:rounded-2xl">
                  <category.icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3
                    id={`tools-${category.id}`}
                    className="flex items-baseline gap-2 text-base font-semibold tracking-tight text-fg sm:text-xl"
                  >
                    {category.name}
                    <span className="text-xs font-normal text-subtle tabular-nums sm:text-sm">
                      {features.length}
                    </span>
                  </h3>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted sm:line-clamp-none sm:text-sm">
                    {category.description}
                  </p>
                </div>
                <span
                  aria-hidden
                  className="hidden h-px flex-1 bg-gradient-to-r from-border to-transparent sm:block"
                />
              </div>
            )}

            <ul className={gridClass}>
              {features.map((f) => (
                <li key={f.key} className="min-w-0">
                  {IN_NATIVE_APP ? <ToolTile feature={f} /> : <FeatureCard feature={f} />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}