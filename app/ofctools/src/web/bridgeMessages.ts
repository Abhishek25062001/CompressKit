/**
 * Messages the web page sends to the app (see bridgeScript.ts for the sending side). Everything
 * arrives as a JSON string through `window.ReactNativeWebView.postMessage`.
 */

/** Why the page is handing a file over: to keep it on the device, or to pass it to another app. */
export type FilePurpose = 'download' | 'share';

export type BridgeMessage =
  /** The bridge is installed in a page. Carries what the WebView can do, for the log. */
  | {
      t: 'ready';
      href: string;
      userAgent: string;
      secureContext: boolean;
      webCodecs: boolean;
      webGpu: boolean;
    }
  /** The page switched between its light and dark theme. */
  | { t: 'theme'; dark: boolean }
  /** A file transfer starts. `group` ties the files of one share together. */
  | {
      t: 'file-begin';
      id: string;
      name: string;
      mime: string;
      size: number;
      purpose: FilePurpose;
      group: string;
    }
  /** The next piece of a file, Base64-encoded. */
  | { t: 'file-chunk'; id: string; seq: number; data: string }
  /** Every piece has been sent. */
  | { t: 'file-end'; id: string; chunks: number }
  /** The page gave up on a transfer. */
  | { t: 'file-abort'; id: string; message: string }
  /** Every file of a share has arrived: open the share sheet. `text` is the title, text and link, if any. */
  | { t: 'share'; group: string; count: number; text: string }
  /** Back was pressed with nowhere to go back to in the page. */
  | { t: 'exit' }
  /** The page cannot tell whether it has history, so the app decides. */
  | { t: 'back-fallback' }
  /** An error in the page, for the log. */
  | { t: 'log'; level: 'error' | 'warn'; message: string };

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * Parses and checks a message from the page. Anything malformed returns null rather than throwing:
 * the page is our own code, but a message decides what gets written to the device, so its shape
 * is verified before it is trusted.
 */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let m: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    m = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (m.t) {
    case 'ready':
      return isString(m.href) && isString(m.userAgent)
        ? {
            t: 'ready',
            href: m.href,
            userAgent: m.userAgent,
            secureContext: m.secureContext === true,
            webCodecs: m.webCodecs === true,
            webGpu: m.webGpu === true,
          }
        : null;
    case 'theme':
      return isBoolean(m.dark) ? { t: 'theme', dark: m.dark } : null;
    case 'file-begin':
      return isString(m.id) &&
        isString(m.name) &&
        isString(m.mime) &&
        isNumber(m.size) &&
        (m.purpose === 'download' || m.purpose === 'share')
        ? {
            t: 'file-begin',
            id: m.id,
            name: m.name,
            mime: m.mime,
            size: m.size,
            purpose: m.purpose,
            group: isString(m.group) ? m.group : '',
          }
        : null;
    case 'file-chunk':
      return isString(m.id) && isNumber(m.seq) && isString(m.data)
        ? { t: 'file-chunk', id: m.id, seq: m.seq, data: m.data }
        : null;
    case 'file-end':
      return isString(m.id) && isNumber(m.chunks)
        ? { t: 'file-end', id: m.id, chunks: m.chunks }
        : null;
    case 'file-abort':
      return isString(m.id)
        ? {
            t: 'file-abort',
            id: m.id,
            message: isString(m.message) ? m.message : '',
          }
        : null;
    case 'share':
      return isString(m.group) && isNumber(m.count)
        ? {
            t: 'share',
            group: m.group,
            count: m.count,
            text: isString(m.text) ? m.text : '',
          }
        : null;
    case 'exit':
      return { t: 'exit' };
    case 'back-fallback':
      return { t: 'back-fallback' };
    case 'log':
      return isString(m.message)
        ? {
            t: 'log',
            level: m.level === 'warn' ? 'warn' : 'error',
            message: m.message,
          }
        : null;
    default:
      return null;
  }
}
