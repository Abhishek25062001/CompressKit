import type { MouseEvent } from 'react';
import { useUiStore } from '../../store/uiStore';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const NAV = [
  { href: '#convert', label: 'Convert' },
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#privacy', label: 'Privacy' },
];

/** "#convert" is not a real anchor: it switches the workspace to the converter, then scrolls to it. */
function onNavClick(e: MouseEvent<HTMLAnchorElement>, href: string) {
  if (href !== '#convert') return;
  e.preventDefault();
  useUiStore.getState().setActiveTool('convert');
  history.replaceState(null, '', '#convert');
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
        <ul className="mx-auto flex max-w-6xl justify-center gap-1 px-4 py-1.5">
          {NAV.map((item) => (
            <li key={item.href}>
              <a href={item.href} onClick={(e) => onNavClick(e, item.href)} className="block rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:text-fg">
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
