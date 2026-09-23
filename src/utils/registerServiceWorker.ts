/**
 * Registers the offline service worker in production builds only, so development never serves
 * stale cached modules. The worker only caches this site's own static files.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => {
      console.warn('[CompressKit] Service worker registration failed:', error);
    });
  });
}
