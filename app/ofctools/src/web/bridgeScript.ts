/**
 * JavaScript injected into the web app's pages. It connects the things a browser would do on its
 * own to the phone:
 *
 *  - A download (`<a download href="blob:…">`, which is how the web app saves every result) is sent
 *    to the app in pieces and written to the device, because a WebView has no download manager for
 *    in-memory files.
 *  - `navigator.share` with files is provided where the WebView lacks it (Android), so "Share"
 *    in Trim & Split opens the system share sheet.
 *  - The page's light/dark theme is reported, so the status bar area matches.
 *  - Back is answered by the page: it closes an open dialog first, then goes back in history.
 *
 * It is plain ES2017 held in a string: Hermes keeps no function source, so a real function could
 * not be turned back into text. `String.raw` keeps backslashes as written. Do not use backticks
 * or dollar-brace inside. The tests run this text in a fake page to check it.
 *
 * Every file piece waits for the app's acknowledgement before the next is read, so a large video
 * never sits in memory twice.
 */
export const BRIDGE_SCRIPT: string = String.raw`
(function () {
  'use strict';
  if (window.__ckNative) return;
  var RN = window.ReactNativeWebView;
  if (!RN || typeof RN.postMessage !== 'function') return;

  // 768 KiB of file per piece: a multiple of three bytes, so its Base64 is exactly 1 MiB with no padding.
  var CHUNK_BYTES = 786432;
  var STEP_TIMEOUT_MS = 60000;
  // Saving copies the finished file and may wait on a permission prompt.
  var SAVE_TIMEOUT_MS = 1200000;

  var counter = 0;
  var waiting = {};

  function post(message) {
    RN.postMessage(JSON.stringify(message));
  }

  function newId(prefix) {
    counter += 1;
    return prefix + counter + '-' + Date.now().toString(36);
  }

  // Resolves when the app acknowledges "key". A timeout of 0 waits for as long as it takes.
  function waitFor(key, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var timer = timeoutMs
        ? setTimeout(function () {
            delete waiting[key];
            reject(new Error('The app did not respond.'));
          }, timeoutMs)
        : 0;
      waiting[key] = { resolve: resolve, reject: reject, timer: timer };
    });
  }

  function settle(key, error) {
    var entry = waiting[key];
    if (!entry) return;
    delete waiting[key];
    if (entry.timer) clearTimeout(entry.timer);
    if (error) entry.reject(new Error(String(error)));
    else entry.resolve();
  }

  function readBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result);
        resolve(text.slice(text.indexOf(',') + 1));
      };
      reader.onerror = function () {
        reject(reader.error || new Error('The file could not be read.'));
      };
      reader.readAsDataURL(blob);
    });
  }

  function describe(error) {
    return String((error && error.message) || error || 'Unknown error');
  }

  async function sendBlob(blob, name, purpose, group) {
    var id = newId('f');
    post({ t: 'file-begin', id: id, name: name, mime: blob.type || '', size: blob.size, purpose: purpose, group: group || '' });
    try {
      await waitFor(id + ':begin', STEP_TIMEOUT_MS);
      var seq = 0;
      for (var offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        var data = await readBase64(blob.slice(offset, offset + CHUNK_BYTES));
        post({ t: 'file-chunk', id: id, seq: seq, data: data });
        await waitFor(id + ':' + seq, STEP_TIMEOUT_MS);
        seq += 1;
      }
      post({ t: 'file-end', id: id, chunks: seq });
      await waitFor(id + ':end', SAVE_TIMEOUT_MS);
    } catch (error) {
      post({ t: 'file-abort', id: id, message: describe(error) });
      throw error;
    }
  }

  // ---- Downloads ----

  function isLocalData(href) {
    return /^(blob:|data:)/i.test(String(href || ''));
  }

  function nativeDownload(href, name) {
    fetch(href)
      .then(function (response) {
        return response.blob();
      })
      .then(function (blob) {
        return sendBlob(blob, name || 'download', 'download', '');
      })
      .catch(function (error) {
        post({ t: 'log', level: 'error', message: 'Download failed (' + (name || 'download') + '): ' + describe(error) });
      });
  }

  var anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && isLocalData(this.href)) {
      nativeDownload(this.href, this.getAttribute('download'));
      return undefined;
    }
    return anchorClick.apply(this, arguments);
  };

  // A download link the person taps directly, rather than one clicked from code.
  document.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      var anchor = target && target.closest ? target.closest('a[download]') : null;
      if (!anchor || !isLocalData(anchor.href)) return;
      event.preventDefault();
      nativeDownload(anchor.href, anchor.getAttribute('download'));
    },
    true
  );

  // ---- Sharing ----

  if (typeof navigator.share !== 'function') {
    var canShare = function (data) {
      return !!(data && ((data.files && data.files.length) || data.text || data.url || data.title));
    };
    var share = async function (data) {
      data = data || {};
      var files = data.files ? Array.prototype.slice.call(data.files) : [];
      var group = newId('s');
      for (var i = 0; i < files.length; i += 1) {
        await sendBlob(files[i], files[i].name || 'file-' + (i + 1), 'share', group);
      }
      var text = [data.title, data.text, data.url]
        .filter(function (part) {
          return !!part;
        })
        .join('\n');
      post({ t: 'share', group: group, count: files.length, text: text });
      await waitFor(group + ':share', 0);
    };
    try {
      Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true, writable: true });
      Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    } catch (error) {
      // The page keeps working without a Share button.
    }
  }

  // ---- Theme ----

  var lastDark = null;
  function reportTheme() {
    var root = document.documentElement;
    if (!root) return;
    var dark = root.classList.contains('dark');
    if (dark === lastDark) return;
    lastDark = dark;
    post({ t: 'theme', dark: dark });
  }

  function startInPage() {
    var root = document.documentElement;
    // The tap flash and the pull-past-the-edge glow belong to a browser, not an app.
    var style = document.createElement('style');
    style.textContent = 'html{-webkit-tap-highlight-color:transparent;overscroll-behavior:none}';
    (document.head || root).appendChild(style);
    reportTheme();
    new MutationObserver(reportTheme).observe(root, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.documentElement && document.head) startInPage();
  else document.addEventListener('DOMContentLoaded', startInPage);

  // ---- Errors, for the app's log ----

  window.addEventListener('error', function (event) {
    var where = event.filename ? ' @ ' + event.filename + ':' + event.lineno : '';
    post({ t: 'log', level: 'error', message: describe(event.error || event.message) + where });
  });
  window.addEventListener('unhandledrejection', function (event) {
    post({ t: 'log', level: 'error', message: 'Unhandled rejection: ' + describe(event.reason) });
  });

  // ---- Called by the app ----

  window.__ckNative = {
    ack: function (key, error) {
      settle(key, error || null);
    },
    back: function () {
      if (document.querySelector('[aria-modal="true"], [role="dialog"]')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
        return;
      }
      var nav = window.navigation;
      if (nav && typeof nav.canGoBack === 'boolean') {
        if (nav.canGoBack) history.back();
        else post({ t: 'exit' });
        return;
      }
      post({ t: 'back-fallback' });
    }
  };

  post({
    t: 'ready',
    href: String(location.href),
    userAgent: String(navigator.userAgent),
    secureContext: window.isSecureContext === true,
    webCodecs: 'VideoEncoder' in window && 'VideoDecoder' in window,
    webGpu: 'gpu' in navigator
  });
})();
true;
`;

/** Tells the page the app handled a step ("key"), or that it failed with `error`. */
export function ackScript(key: string, error?: string): string {
  return `window.__ckNative&&window.__ckNative.ack(${JSON.stringify(
    key,
  )},${JSON.stringify(error ?? null)});true;`;
}

/** Asks the page to handle Back. A page without the bridge (still loading) hands the decision to the app. */
export const BACK_SCRIPT =
  'if(window.__ckNative){window.__ckNative.back();}else if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(\'{"t":"back-fallback"}\');}true;';
