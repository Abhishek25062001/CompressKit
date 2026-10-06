import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewHttpErrorEvent,
  WebViewOpenWindowEvent,
} from 'react-native-webview/lib/WebViewTypes';
import {
  EXPORT_DIR,
  receiverFs,
  saveToDevice,
  shareFiles,
} from '../files/deviceStorage';
import {
  errorMessage,
  ExportReceiver,
  type SavedFile,
} from '../files/exportReceiver';
import type { Palette } from '../theme';
import { Notice, type NoticeData } from '../ui/Notice';
import { StartupScreen } from '../ui/StartupScreen';
import { parseBridgeMessage } from './bridgeMessages';
import { ackScript, BACK_SCRIPT, BRIDGE_SCRIPT } from './bridgeScript';
import type { WebSite } from './webServer';
import { platformWebViewProps } from './webViewProps';

interface WebAppProps {
  site: WebSite;
  palette: Palette;
  /** The page switched between its light and dark theme. */
  onThemeChange: (dark: boolean) => void;
  /** The page could not be loaded from the local server; the parent restarts it. */
  onRestart: () => void;
}

const EXTERNAL_SCHEMES = /^(https?|mailto|tel):/i;

function openExternally(url: string): void {
  if (EXTERNAL_SCHEMES.test(url)) Linking.openURL(url).catch(() => undefined);
}

/**
 * The tools themselves: the web app, loaded from the server on this phone, with the phone's own
 * saving, sharing, Back button and links wired to it.
 */
export function WebApp({
  site,
  palette,
  onThemeChange,
  onRestart,
}: WebAppProps) {
  // `WebView<object>`: the library's class takes extra props as a type argument that defaults
  // to `undefined`, and TypeScript then reads the props of a plain `WebView` as "none allowed".
  const webRef = useRef<WebView<object>>(null);
  const canGoBack = useRef(false);
  const pageReady = useRef(false);
  const noticeId = useRef(0);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  /** Changing the key builds a fresh WebView, which is the only way back after its process died. */
  const [webKey, setWebKey] = useState(0);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);

  // A page served by the app itself. Android reports a message's source as the bare origin and
  // iOS as the full address; both count. The type check is for an event with no address at all.
  const isOwnPage = useCallback(
    (url: unknown): url is string =>
      typeof url === 'string' &&
      (url === site.origin || url.startsWith(`${site.origin}/`)),
    [site.origin],
  );
  // What the WebView may load: its own pages, and the in-memory documents they create.
  const isInternal = useCallback(
    (url: unknown) =>
      isOwnPage(url) ||
      (typeof url === 'string' && /^(about|blob|data):/i.test(url)),
    [isOwnPage],
  );

  const showNotice = useCallback((data: Omit<NoticeData, 'id'>) => {
    noticeId.current += 1;
    setNotice({ ...data, id: noticeId.current });
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const share = useCallback(
    (file: SavedFile) => {
      shareFiles([{ path: file.path, mime: file.mime }]).catch(
        (error: unknown) => {
          showNotice({
            tone: 'error',
            title: 'Sharing failed',
            detail: errorMessage(error),
          });
        },
      );
    },
    [showNotice],
  );

  const [receiver] = useState(
    () =>
      new ExportReceiver({
        exportDir: EXPORT_DIR,
        fs: receiverFs,
        ack: (key, error) =>
          webRef.current?.injectJavaScript(ackScript(key, error)),
        save: saveToDevice,
        share: shareFiles,
        onSaved: file =>
          showNotice({
            tone: 'success',
            title: `Saved to ${file.place}`,
            detail: file.name,
            action: { label: 'Share', onPress: () => share(file) },
          }),
        onFailed: (name, message) =>
          showNotice({
            tone: 'error',
            title: 'The file could not be saved',
            detail: `${name}: ${message}`,
          }),
      }),
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      // Only pages served by the app itself are listened to.
      if (!isOwnPage(event.nativeEvent.url)) return;
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message || receiver.handle(message)) return;
      switch (message.t) {
        case 'ready':
          pageReady.current = true;
          console.log(
            `[web] ready ${message.href} secureContext=${message.secureContext} webCodecs=${message.webCodecs} webGpu=${message.webGpu} ua=${message.userAgent}`,
          );
          break;
        case 'theme':
          onThemeChange(message.dark);
          break;
        case 'exit':
          BackHandler.exitApp();
          break;
        case 'back-fallback':
          if (canGoBack.current) webRef.current?.goBack();
          else BackHandler.exitApp();
          break;
        case 'log':
          console.warn(`[web] ${message.message}`);
          break;
      }
    },
    [isOwnPage, onThemeChange, receiver],
  );

  // Android's Back button: the page closes an open dialog or goes back; at the first page the app closes.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (!pageReady.current || !webRef.current) return false;
        webRef.current.injectJavaScript(BACK_SCRIPT);
        return true;
      },
    );
    return () => subscription.remove();
  }, []);

  const onNavigationStateChange = useCallback(
    (navigation: WebViewNavigation) => {
      canGoBack.current = navigation.canGoBack;
    },
    [],
  );

  // Links that lead out of the app (the author's site, a link typed into a document) open in the browser.
  const onShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest) => {
      if (isInternal(request.url)) return true;
      openExternally(request.url);
      return false;
    },
    [isInternal],
  );

  const onOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => {
      const url = event.nativeEvent.targetUrl;
      if (isInternal(url))
        webRef.current?.injectJavaScript(
          `window.location.assign(${JSON.stringify(url)});true;`,
        );
      else openExternally(url);
    },
    [isInternal],
  );

  // The WebView's process is separate from the app's and the system ends it when a job needs more memory than the phone has.
  const onProcessGone = useCallback(() => {
    pageReady.current = false;
    canGoBack.current = false;
    setWebKey(key => key + 1);
    showNotice({
      tone: 'error',
      title: 'The tool ran out of memory and was restarted',
      detail: 'Try a smaller file, or fewer files at a time.',
    });
  }, [showNotice]);

  const onHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => {
      const { statusCode, url } = event.nativeEvent;
      // Only the page itself matters here; a missing optional file is the page's to handle.
      if (
        statusCode >= 400 &&
        (url === `${site.origin}/` || url === site.origin)
      )
        setLoadFailed(`The start page answered with ${statusCode}.`);
    },
    [site.origin],
  );

  const renderLoading = useCallback(
    () => (
      <View style={StyleSheet.absoluteFill}>
        <StartupScreen
          palette={palette}
          state={{ status: 'starting', stage: 'starting' }}
          onRetry={onRestart}
        />
      </View>
    ),
    [palette, onRestart],
  );

  const renderError = useCallback(
    (_domain: string | undefined, _code: number, description: string) => (
      <View style={StyleSheet.absoluteFill}>
        <StartupScreen
          palette={palette}
          state={{ status: 'error', missingBuild: false, message: description }}
          onRetry={onRestart}
        />
      </View>
    ),
    [palette, onRestart],
  );

  if (loadFailed !== null) {
    return (
      <StartupScreen
        palette={palette}
        state={{ status: 'error', missingBuild: false, message: loadFailed }}
        onRetry={onRestart}
      />
    );
  }

  return (
    // With edge-to-edge layout Android no longer shrinks the window for the keyboard, so the
    // WebView is padded by hand; a WKWebView on iOS already moves its content itself.
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'android' ? 'padding' : undefined}
    >
      <WebView
        key={webKey}
        ref={webRef}
        source={{ uri: `${site.origin}/` }}
        originWhitelist={['*']}
        style={[styles.fill, { backgroundColor: palette.bg }]}
        containerStyle={{ backgroundColor: palette.bg }}
        javaScriptEnabled
        domStorageEnabled
        injectedJavaScriptBeforeContentLoaded={BRIDGE_SCRIPT}
        injectedJavaScript={BRIDGE_SCRIPT}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoad}
        onOpenWindow={onOpenWindow}
        onRenderProcessGone={onProcessGone}
        onContentProcessDidTerminate={onProcessGone}
        onHttpError={onHttpError}
        startInLoadingState
        renderLoading={renderLoading}
        renderError={renderError}
        mediaPlaybackRequiresUserAction={false}
        showsHorizontalScrollIndicator={false}
        webviewDebuggingEnabled={__DEV__}
        {...platformWebViewProps(Platform.OS)}
      />
      <Notice palette={palette} notice={notice} onDismiss={dismissNotice} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
