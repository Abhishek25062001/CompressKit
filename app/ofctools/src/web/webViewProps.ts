/**
 * WebView settings that belong to one platform only.
 *
 * They are kept apart because the WebView library hands every setting it is given to the native
 * side of whichever platform is running. A setting written the iOS way (`decelerationRate` as the
 * word "normal") reaches Android as text where Android's native code expects a number, and the
 * app stops with "String cannot be cast to Double". So each platform only ever receives its own.
 */
import type { WebViewProps } from 'react-native-webview';

/** iOS (WKWebView). */
export const IOS_WEBVIEW_PROPS: Partial<WebViewProps> = {
  // Videos play in the page instead of taking over the screen.
  allowsInlineMediaPlayback: true,
  // Swipe from the screen edge to go back, as in other apps.
  allowsBackForwardNavigationGestures: true,
  // No link preview on a long press.
  allowsLinkPreview: false,
  // The page does not rubber-band past its ends, and scrolling slows down like a native list.
  bounces: false,
  decelerationRate: 'normal',
  // Phone numbers and addresses in a document are not turned into links.
  dataDetectorTypes: ['none'],
  // The app pads for the notch and home bar itself (App.tsx).
  automaticallyAdjustContentInsets: false,
  contentInsetAdjustmentBehavior: 'never',
};

/** Android (Chromium WebView). */
export const ANDROID_WEBVIEW_PROPS: Partial<WebViewProps> = {
  // No stretch or glow when the page is pulled past its ends.
  overScrollMode: 'never',
  // The page sets its own text sizes; the system font-size setting would break its layout.
  textZoom: 100,
  // A link that opens a new window is reported to the app, which sends it to the browser.
  setSupportMultipleWindows: true,
  // The full-screen button on a video works.
  allowsFullscreenVideo: true,
};

export function platformWebViewProps(os: string): Partial<WebViewProps> {
  return os === 'android' ? ANDROID_WEBVIEW_PROPS : IOS_WEBVIEW_PROPS;
}
