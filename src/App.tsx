import { MotionConfig } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { Notices } from './components/common/Notices';
import { Footer } from './components/layout/Footer';
import { Header } from './components/layout/Header';
import { HomePage } from './components/pages/HomePage';
import { NotFoundPage } from './components/pages/NotFoundPage';
import { ToolPage } from './components/pages/ToolPage';
import { CATALOG, HOME_META, SITE_NAME } from './features/catalog';
import { useApplyTheme } from './hooks/useApplyTheme';
import { useCapabilitiesStore } from './store/capabilitiesStore';
import { useRouteStore } from './store/routeStore';

function setMeta(title: string, description: string): void {
  document.title = title;
  for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    document.querySelector(selector)?.setAttribute('content', description);
  }
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    document.querySelector(selector)?.setAttribute('content', title);
  }
}

/** Which page an address shows, with its title and description. */
function usePage() {
  const path = useRouteStore((s) => s.path);
  const hash = useRouteStore((s) => s.hash);
  const visit = useRouteStore((s) => s.visit);
  const tool = CATALOG.find((t) => t.path === path);
  const page = path === '/' ? 'home' : tool ? 'tool' : 'missing';

  useEffect(() => {
    if (page === 'home') setMeta(HOME_META.title, HOME_META.description);
    else if (tool) setMeta(tool.title, tool.description);
    else setMeta(`Page not found | ${SITE_NAME}`, HOME_META.description);
  }, [page, tool]);

  // A new page starts at the top, or at the section its link names (e.g. "/#privacy"). Moving to
  // another page jumps there; a link within the same page scrolls smoothly.
  const shownPath = useRef(path);
  useEffect(() => {
    const behavior: ScrollBehavior = shownPath.current === path ? 'smooth' : 'instant';
    shownPath.current = path;
    const target = hash ? document.getElementById(hash) : null;
    if (target) target.scrollIntoView({ block: 'start', behavior });
    else window.scrollTo({ top: 0, behavior });
  }, [path, hash, visit]);

  return { page, tool };
}

export default function App() {
  useApplyTheme();
  const detect = useCapabilitiesStore((s) => s.detect);
  const { page, tool } = usePage();

  useEffect(() => {
    void detect();
    // Dropping a file outside the drop zone must not navigate away from the app.
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, [detect]);

  return (
    <MotionConfig reducedMotion="user">
      <a
        href={page === 'tool' ? '#tool' : '#main'}
        className="sr-only z-50 rounded-lg bg-surface px-4 py-2 text-sm font-medium text-fg shadow focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {page === 'tool' ? `Skip to ${tool!.name.toLowerCase()}` : 'Skip to content'}
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="outline-none">
        {page === 'home' ? <HomePage /> : tool ? <ToolPage key={tool.id} id={tool.id} /> : <NotFoundPage />}
      </main>
      <Footer />
      <Notices />
    </MotionConfig>
  );
}
