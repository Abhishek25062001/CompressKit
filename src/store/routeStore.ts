import { create } from 'zustand';
import { LEGACY_HASHES } from '../features/catalog';

/** The site's base path from vite.config.ts ("/" or e.g. "/compresskit/"), without the trailing slash. */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** "/compresskit/compress/" → "/compress". The address the app routes on, without the base path. */
function currentPath(): string {
  if (typeof window === 'undefined') return '/';
  let path = window.location.pathname;
  if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length);
  path = path.replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  return path || '/';
}

/** Turns an app path ("/compress", "/#privacy") into a URL for the address bar and links. */
export function href(to: string): string {
  return `${BASE}${to}`;
}

interface RouteState {
  path: string;
  /** Section to scroll to after navigating, e.g. "privacy" for "/#privacy". */
  hash: string;
  /** Counts navigations, so following the same link twice still scrolls. */
  visit: number;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

export const useRouteStore = create<RouteState>()((set) => ({
  path: currentPath(),
  hash: typeof window === 'undefined' ? '' : window.location.hash.slice(1),
  visit: 0,
  navigate: (to, options) => {
    const url = href(to);
    if (options?.replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    set((s) => ({ path: currentPath(), hash: window.location.hash.slice(1), visit: s.visit + 1 }));
  },
}));

/** Back and forward buttons, and links shared from before tools had their own pages. */
export function startRouter(): void {
  const legacy = LEGACY_HASHES[window.location.hash];
  if (legacy && currentPath() === '/') useRouteStore.getState().navigate(legacy, { replace: true });
  window.addEventListener('popstate', () => {
    useRouteStore.setState((s) => ({ path: currentPath(), hash: window.location.hash.slice(1), visit: s.visit + 1 }));
  });
}
