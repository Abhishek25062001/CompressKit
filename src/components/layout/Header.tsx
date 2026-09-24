import { Link } from '../common/Link';
import { ToolsMenu } from '../tools/ToolsMenu';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const linkClass = 'hidden rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg md:block';

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/75 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/60">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" aria-label="CompressKit home" className="rounded-lg">
          <Logo />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          <ToolsMenu />
          <Link to="/#how-it-works" className={linkClass}>
            How it works
          </Link>
          <Link to="/#privacy" className={linkClass}>
            Privacy
          </Link>
          <div className="ml-1 h-5 w-px bg-border" aria-hidden />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
