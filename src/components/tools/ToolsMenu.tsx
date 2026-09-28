import { LayoutGrid } from 'lucide-react';
import { useEffect } from 'react';
import { useUiStore } from '../../store/uiStore';
import { cn } from '../../utils/cn';
import { TOOLS_SHORTCUT } from '../../utils/shortcut';
import { ToolsLauncher } from './ToolsLauncher';

/**
 * The header's Tools button. It opens the full-page launcher with every tool by category, as do
 * Cmd/Ctrl+K anywhere and "/" when not typing.
 */
export function ToolsMenu() {
  const open = useUiStore((s) => s.toolsOpen);
  const openTools = useUiStore((s) => s.openTools);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
      const shortcut = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
      const slash = e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (!shortcut && !slash) return;
      const ui = useUiStore.getState();
      if (shortcut && ui.toolsOpen) {
        e.preventDefault();
        ui.closeTools();
        return;
      }
      // Leave the keys to editors, and never stack the launcher on another open dialog.
      if (target?.closest?.('[contenteditable="true"]') || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      ui.openTools(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => openTools(false)}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
          open ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden />
        All tools
        <kbd className="ml-1 hidden rounded border border-border bg-surface px-1.5 py-px font-sans text-[11px] font-normal text-subtle lg:inline" aria-hidden>
          {TOOLS_SHORTCUT}
        </kbd>
      </button>
      <ToolsLauncher />
    </>
  );
}
