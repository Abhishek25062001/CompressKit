import { useCallback, useEffect, useState } from 'react';
import { clearExports } from '../files/deviceStorage';
import { errorMessage } from '../files/exportReceiver';
import {
  onWebServerCrash,
  startWebSite,
  WebBuildMissingError,
  type StartStage,
  type WebSite,
} from './webServer';

export type WebSiteState =
  | { status: 'starting'; stage: StartStage }
  | { status: 'ready'; site: WebSite }
  | { status: 'error'; missingBuild: boolean; message: string };

/**
 * Starts the local web server when the app opens and reports how far it has got. `retry` starts
 * over after a failure; the server stopping on its own later also lands in the error state, so
 * the person gets a "Try again" button rather than a page that silently stops loading.
 */
export function useWebSite(): { state: WebSiteState; retry: () => void } {
  const [state, setState] = useState<WebSiteState>({
    status: 'starting',
    stage: 'checking',
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const onStage = (stage: StartStage) => {
      if (current) setState({ status: 'starting', stage });
    };
    // Leftovers from the last run are removed before anything new can arrive.
    clearExports()
      .then(() => startWebSite(onStage, attempt > 0))
      .then(
        site => {
          if (current) setState({ status: 'ready', site });
        },
        (error: unknown) => {
          if (current)
            setState({
              status: 'error',
              missingBuild: error instanceof WebBuildMissingError,
              message: errorMessage(error),
            });
        },
      );
    onWebServerCrash(details => {
      if (current)
        setState({
          status: 'error',
          missingBuild: false,
          message: details || 'The local server stopped.',
        });
    });
    return () => {
      current = false;
      onWebServerCrash(null);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ status: 'starting', stage: 'checking' });
    setAttempt(n => n + 1);
  }, []);
  return { state, retry };
}
