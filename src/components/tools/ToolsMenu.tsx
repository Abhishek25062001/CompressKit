import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ChevronDown, LayoutGrid } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { CATALOG } from '../../features/catalog';
import { TOOL_CONTENT } from '../../features/toolContent';
import { useRouteStore } from '../../store/routeStore';
import { cn } from '../../utils/cn';
import { Link } from '../common/Link';

/** The header's list of every tool: a disclosure with links, closed by Escape, a click outside or navigating. */
export function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const path = useRouteStore((s) => s.path);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
          open ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
        Tools
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="card fixed inset-x-3 top-[4.25rem] z-50 max-h-[calc(100dvh-5.5rem)] origin-top-right overflow-y-auto p-2 shadow-xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[34rem]"
          >
            <ul className="grid gap-1 sm:grid-cols-2">
              {CATALOG.map((tool) => {
                const Icon = TOOL_CONTENT[tool.id].icon;
                const current = path === tool.path;
                return (
                  <li key={tool.id}>
                    <Link
                      to={tool.path}
                      onClick={() => setOpen(false)}
                      aria-current={current ? 'page' : undefined}
                      className={cn(
                        'flex items-start gap-3 rounded-xl p-2.5 transition-colors',
                        current ? 'bg-accent-soft/70' : 'hover:bg-surface-2',
                      )}
                    >
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text">
                        <Icon className="h-4.5 w-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-fg">{tool.name}</span>
                        <span className="block text-xs leading-snug text-muted">{tool.tagline}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-1 border-t border-border px-2.5 pt-2 pb-1">
              <Link
                to="/#tools"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-accent-text hover:underline"
              >
                See all tools on the home page <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
