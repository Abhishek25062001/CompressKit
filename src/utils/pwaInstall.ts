/**
 * Android Chrome fires `beforeinstallprompt` when the site is installable, and often skips its own
 * popup. iOS has no install event in any browser. Since iOS 16.4, Chrome, Safari, Edge, and
 * Firefox can each add the site from their own Share menu. A page cannot open that menu itself.
 */

export type IosInstallTarget = 'safari' | 'chrome' | 'browser' | 'in-app';

const DISMISS_KEY = 'ofctools-install-dismissed';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  );
}

export function iosInstallTarget(): IosInstallTarget | null {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios) return null;
  if (/CriOS/.test(ua)) return 'chrome';
  if (/FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo/.test(ua)) return 'browser';
  if (/Instagram|FBAN|FBAV|Line\/|Twitter|Snapchat|GSA\/|TikTok|Musical_ly/i.test(ua)) return 'in-app';
  return 'safari';
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** Full Chrome on Android, not a WebView or another browser that puts "Chrome" in the UA. */
export function isAndroidChrome(): boolean {
  const ua = navigator.userAgent;
  return isAndroid() && /Chrome\/\d/.test(ua) && !/EdgA|OPR|SamsungBrowser|YaBrowser|UCBrowser|DuckDuckGo|; wv\)/.test(ua);
}

export function installPromptDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

export function dismissInstallPrompt(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* Private mode can block storage. The banner still closes for this visit. */
  }
}
