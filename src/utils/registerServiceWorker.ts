import { IN_NATIVE_APP } from './nativeApp';

/**
 * Registers the offline service worker in production builds only, so development never serves
 * stale cached modules. The worker only caches this site's own static files.
 */
export function registerServiceWorker(): void {
  // Inside the Android/iOS app every file is already on the phone (and sw.js is not shipped), so a
  // service worker would only store a second copy of each engine and model.
  if (!import.meta.env.PROD || IN_NATIVE_APP || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((error: unknown) => {
      console.warn('[ofctools] Service worker registration failed:', error);
    });
  });
}
