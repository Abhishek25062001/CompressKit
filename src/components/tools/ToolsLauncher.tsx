import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Search, SearchX, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORY_BY_ID, FEATURES, FEATURES_BY_CATEGORY, searchFeatures, type Feature } from '../../features/directory';
import { useDialog } from '../../hooks/useDialog';
import { useRouteStore } from '../../store/routeStore';
import { useUiStore } from '../../store/uiStore';
import { cn } from '../../utils/cn';
import { Link } from '../common/Link';
import { hue } from './hue';

/** Marks the links the arrow keys move between (data-launcher-item on each). */
const ITEM = 'data-launcher-item';

const SUGGESTIONS = ['HEIC', 'passport', 'merge', 'MP3', 'Word', 'compress'];

/** "/convert#gif" while that job is on screen, else just the path. */
function useHere(): string {
  const path = useRouteStore((s) => s.path);
  const hash = useRouteStore((s) => s.hash);
  return hash ? `${path}#${hash}` : path;
}

function CompactLink({ feature, current, onPick }: { feature: Feature; current: boolean; onPick: () => void }) {
  return (
    <Link
      to={feature.to}
      onClick={onPick}
      title={feature.description}
      aria-current={current ? 'page' : undefined}
      data-launcher-item=""
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm outline-offset-0 transition-colors',
        current ? 'bg-accent-soft font-medium text-fg' : 'text-fg/90 hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2',
      )}
    >
      <feature.icon className="h-4 w-4 shrink-0 text-(color:--hue)" aria-hidden />
      <span className="truncate">{feature.name}</span>
    </Link>
  );
}

function ResultLink({ feature, first, current, onPick }: { feature: Feature; first: boolean; current: boolean; onPick: () => void }) {
  return (
    <Link
      to={feature.to}
      onClick={onPick}
      aria-current={current ? 'page' : undefined}
      style={hue(feature.category)}
      data-launcher-item=""
      className={cn(
        'group flex h-full items-start gap-3 rounded-xl border p-3 outline-offset-0 transition-colors',
        first ? 'border-accent/50 bg-accent-soft/40' : 'border-border bg-surface hover:border-border-strong',
        'hover:bg-surface-2 focus-visible:bg-surface-2',
      )}
    >
      <span className="hue-tile inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
        <feature.icon className="h-4.5 w-4.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg">{feature.name}</span>
          {first && (
            <kbd className="ml-auto hidden shrink-0 items-center gap-1 rounded border border-border bg-surface px-1.5 font-sans text-[11px] text-muted sm:inline-flex">
              <CornerDownLeft className="h-3 w-3" aria-hidden />
              <span className="sr-only">Enter opens this</span>
            </kbd>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">{feature.description}</span>
        <span className="mt-1.5 block text-[11px] font-medium text-(color:--hue)">{CATEGORY_BY_ID[feature.category].name}</span>
      </span>
    </Link>
  );
}

function LauncherPanel({ focusSearch, onClose }: { focusSearch: boolean; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const here = useHere();
  const results = useMemo(() => searchFeatures(query), [query]);
  const searching = query.trim().length > 0;

  // Typing is the fastest way in with a keyboard; on touch screens the keyboard would cover the
  // list, so the search box is focused only when the launcher was opened to search.
  useDialog(true, onClose, panelRef, () =>
    focusSearch || window.matchMedia('(pointer: fine)').matches ? inputRef.current : panelRef.current,
  );

  // Back and forward buttons move to another page: close rather than cover it.
  useEffect(() => useRouteStore.subscribe((route, previous) => route.visit !== previous.visit && onClose()), [onClose]);

  const openFirst = () => {
    const first = results[0];
    if (!first) return;
    onClose();
    useRouteStore.getState().navigate(first.to);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searching) {
      e.preventDefault();
      openFirst();
    } else if (e.key === 'Escape' && query) {
      // First Escape clears the search, the next one closes.
      e.preventDefault();
      setQuery('');
    }
  };

  // Up and down arrows move through the links in reading order, and back up into the search box.
  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(`[${ITEM}]`) ?? []);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1 && e.target !== inputRef.current) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
    if (next < 0) inputRef.current?.focus();
    else items[Math.min(next, items.length - 1)].focus();
  };

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onPanelKey}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex flex-col bg-bg/95 outline-none backdrop-blur-xl"
    >
      <div className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6 sm:py-4">
          <div className="hidden shrink-0 md:block">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              All tools
            </h2>
            <p className="text-xs text-muted">{FEATURES.length} tools · nothing is uploaded</p>
          </div>
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 shadow-[var(--shadow-soft)] focus-within:border-accent md:mx-auto md:max-w-xl">
            <Search className="h-4.5 w-4.5 shrink-0 text-muted" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={`Search ${FEATURES.length} tools`}
              aria-label="Search tools"
              aria-controls={`${titleId}-list`}
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="-mr-1 rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close all tools"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-2.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg md:px-3"
          >
            <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] md:inline">Esc</kbd>
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div id={`${titleId}-list`} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          {!searching ? (
            <div className="columns-1 gap-x-8 sm:columns-2 lg:columns-4">
              {FEATURES_BY_CATEGORY.map(({ category, features }) => (
                <section key={category.id} aria-labelledby={`${titleId}-${category.id}`} style={hue(category.id)} className="mb-7 break-inside-avoid">
                  <h3 id={`${titleId}-${category.id}`} className="mb-1.5 flex items-center gap-2 px-2 text-xs font-semibold tracking-wide text-muted uppercase">
                    <span className="hue-tile inline-flex h-6 w-6 items-center justify-center rounded-md">
                      <category.icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {category.name}
                    <span className="font-normal text-subtle tabular">{features.length}</span>
                  </h3>
                  <ul>
                    {features.map((f) => (
                      <li key={f.key}>
                        <CompactLink feature={f} current={f.to === here} onPick={onClose} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <>
              <p className="mb-4 text-sm text-muted" aria-live="polite">
                {results.length
                  ? `${results.length} tool${results.length === 1 ? '' : 's'} for “${query.trim()}”`
                  : `No tool matches “${query.trim()}”`}
              </p>
              {results.length > 0 ? (
                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {results.map((f, i) => (
                    <li key={f.key}>
                      <ResultLink feature={f} first={i === 0} current={f.to === here} onPick={onClose} />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="card flex flex-col items-center px-6 py-12 text-center">
                  <SearchX className="h-8 w-8 text-subtle" aria-hidden />
                  <p className="mt-3 max-w-md text-sm text-muted">
                    Try a file type or a task instead. For example:
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          setQuery(s);
                          inputRef.current?.focus();
                        }}
                        className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-muted transition-colors hover:border-border-strong hover:text-fg"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Every tool on one screen, by category, with a search box. Opened from the header's Tools button. */
export function ToolsLauncher() {
  const open = useUiStore((s) => s.toolsOpen);
  const focusSearch = useUiStore((s) => s.toolsSearch);
  const close = useUiStore((s) => s.closeTools);
  return createPortal(<AnimatePresence>{open && <LauncherPanel key="launcher" focusSearch={focusSearch} onClose={close} />}</AnimatePresence>, document.body);
}
