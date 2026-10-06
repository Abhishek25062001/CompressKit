/**
 * Extra settings for the embedded web server (Lighttpd), appended to the ones the server library
 * writes. Kept apart from the code that starts the server so the text can be checked in a test.
 */

/**
 * Content types by file ending. Setting this list replaces the server's built-in one, so it has
 * to name everything the web build contains. The ones that matter most: `.mjs` and `.js` must be
 * JavaScript or the browser refuses to run them as modules and workers, and `.wasm` must be
 * `application/wasm` for WebAssembly to compile while it downloads.
 */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'text/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.gz': 'application/gzip',
  '.bin': 'application/octet-stream',
  '.onnx': 'application/octet-stream',
  // Anything else.
  '': 'application/octet-stream',
};

/**
 * Lighttpd configuration text.
 *
 * `Cache-Control: no-cache` makes the WebView ask "has this changed?" before reusing a stored
 * copy. Without it a page stored before an app update could keep pointing at script files the
 * update removed. The check is a request to this same phone, so it costs next to nothing.
 */
export function buildServerConfig(): string {
  const types = Object.entries(MIME_TYPES)
    .map(([ending, type]) => `  "${ending}" => "${type}"`)
    .join(',\n');
  return [
    'server.modules += ("mod_setenv")',
    'setenv.add-response-header = ("Cache-Control" => "no-cache")',
    `mimetype.assign = (\n${types}\n)`,
  ].join('\n');
}
