import { Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IN_NATIVE_APP } from '../../utils/nativeApp';
import {
  dismissInstallPrompt,
  installPromptDismissed,
  iosInstallTarget,
  isAndroid,
  isAndroidChrome,
  isStandalone,
  type BeforeInstallPromptEvent,
} from '../../utils/pwaInstall';
import { Button } from './Button';

type Mode = 'install' | 'ios-safari' | 'ios-other' | 'android-chrome' | 'android-other';

export function InstallPrompt() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (IN_NATIVE_APP || isStandalone() || installPromptDismissed()) return;

    const ios = iosInstallTarget();
    if (ios) {
      setMode(ios === 'safari' ? 'ios-safari' : 'ios-other');
      return;
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      setMode('install');
    };
    const onInstalled = () => {
      setPromptEvent(null);
      setMode(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);

    // Chrome often withholds its own popup. If it also withholds the event, say where Install lives.
    const fallback = window.setTimeout(() => {
      setMode((current) => {
        if (current !== null || !isAndroid()) return current;
        return isAndroidChrome() ? 'android-chrome' : 'android-other';
      });
    }, 1500);

    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!mode) return null;

  const dismiss = () => {
    dismissInstallPrompt();
    setPromptEvent(null);
    setMode(null);
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === 'accepted') setMode(null);
    else dismiss();
  };

  return (
    <div className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-start gap-3 px-4 py-3 sm:items-center sm:px-6">
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{titleFor(mode)}</p>
          <PromptBody mode={mode} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {mode === 'install' && (
            <Button variant="primary" size="sm" onClick={() => void install()}>
              Install
            </Button>
          )}
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss install instructions"
            className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function titleFor(mode: Mode): string {
  if (mode === 'install') return 'Install ofctools';
  if (mode === 'ios-other') return 'Open ofctools in Safari';
  if (mode === 'android-other') return 'Open ofctools in Chrome';
  return 'Add ofctools to your Home Screen';
}

function PromptBody({ mode }: { mode: Mode }) {
  if (mode === 'install') {
    return <p className="mt-0.5 text-sm text-muted">Add it to your home screen and open it like any other app.</p>;
  }
  if (mode === 'ios-safari') {
    return (
      <ol className="mt-1.5 space-y-1 text-sm text-muted">
        <li className="flex items-start gap-1.5">
          <Share className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden />
          <span>
            Tap <span className="font-medium text-fg">Share</span> in Safari.
          </span>
        </li>
        <li className="pl-5">
          Tap <span className="font-medium text-fg">Add to Home Screen</span>, then <span className="font-medium text-fg">Add</span>.
        </li>
      </ol>
    );
  }
  if (mode === 'ios-other') {
    return (
      <p className="mt-0.5 text-sm text-muted">
        Open this page in Safari, tap <span className="font-medium text-fg">Share</span>, then{' '}
        <span className="font-medium text-fg">Add to Home Screen</span>.
      </p>
    );
  }
  if (mode === 'android-chrome') {
    return (
      <p className="mt-0.5 text-sm text-muted">
        Tap the Chrome menu <span className="font-medium text-fg">⋮</span> at the top right, then{' '}
        <span className="font-medium text-fg">Install app</span>.
      </p>
    );
  }
  return (
    <p className="mt-0.5 text-sm text-muted">
      Open this page in Chrome, then use the menu to install the app or add it to your home screen.
    </p>
  );
}
