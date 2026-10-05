/**
 * True when the site is running inside the Android or iOS app (app/ofctools), which shows it in
 * a WebView. The WebView puts `ReactNativeWebView` on the window before any page script runs.
 *
 * The app handles downloads, sharing and the Back button itself, so this is only needed for the
 * few things a WebView cannot do at all, such as opening a print dialog.
 */
export const IN_NATIVE_APP = typeof window !== 'undefined' && 'ReactNativeWebView' in window;
