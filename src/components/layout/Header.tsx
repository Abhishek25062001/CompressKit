import type { MouseEvent } from 'react';
import { isToolHash, toolFromHash, useUiStore } from '../../store/uiStore';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '#convert', label: 'Convert' },
  { href: '#resize', label: 'Resize' },
  { href: '#trim', label: 'Trim' },
  { href: '#pdf', label: 'PDF' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#privacy', label: 'Privacy' },
];

/** Tool links are not real anchors: they switch the workspace to that tool, then scroll to it. */
function onNavClick(e: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!isToolHash(href)) return;
  e.preventDefault();
  history.replaceState(null, '', href);
  useUiStore.getState().setActiveTool(toolFromHash());
  document.getElementById('compress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/75 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a href="#top" aria-label="CompressKit home" className="rounded-lg">
          <Logo />
        </a>
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          <ul className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={(e) => onNavClick(e, item.href)}
                  className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="ml-1 hidden h-5 w-px bg-border md:block" aria-hidden />
          <ThemeToggle />
        </nav>
      </div>
      <nav aria-label="Sections" className="border-t border-border/60 md:hidden">
        {/* Six links do not fit a phone screen: the row scrolls sideways instead of wrapping. */}
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] sm:justify-center">
          {NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href} onClick={(e) => onNavClick(e, item.href)} className="block rounded-md px-2.5 py-1.5 text-[13px] whitespace-nowrap text-muted hover:text-fg">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
