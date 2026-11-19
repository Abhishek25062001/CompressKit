/* ofctools service worker: caches this site's own static files for offline use.
   It never touches user files, which are handled in memory and never requested over the network. */
const CACHE = 'compresskit-v4';
/* AI model parts, shared with the background worker (src/features/background/model.ts, MODEL_CACHE).
   Their folder names carry the model hash, so this cache survives app updates. */
const MODEL_CACHE = 'ofctools-models-v1';
const SCOPE = self.registration.scope;
const PRECACHE = [
  '',
  'index.html',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
].map((p) => new URL(p, SCOPE).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

/* Hashed files (scripts, engines, OCR data, model parts) that are not part of the current build
   are deleted, so each deployment does not leave another copy behind. The list is written at build
   time (cache-manifest.json). Pages and icons keep their names and are refreshed in place. */
const HASHED = ['/assets/', '/models/', '/ocr/'];
let lastPrune = 0;

async function pruneStale() {
  const res = await fetch(new URL('cache-manifest.json', SCOPE).href, { cache: 'no-store' });
  if (!res.ok) return;
  const { files } = await res.json();
  if (!Array.isArray(files) || files.length === 0) return;
  const keep = new Set(files.map((f) => new URL(f, SCOPE).pathname));
  for (const name of [CACHE, MODEL_CACHE]) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const { pathname } = new URL(request.url);
      if (HASHED.some((p) => pathname.includes(p)) && !keep.has(pathname)) await cache.delete(request);
    }
  }
}

/** At most once an hour while the service worker is alive; offline or a missing list skips it. */
function pruneSoon() {
  const now = Date.now();
  if (now - lastPrune < 3_600_000) return Promise.resolve();
  lastPrune = now;
  return pruneStale().catch(() => undefined);
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MODEL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(pruneSoon),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App shell: network first so deployments show up, cached copy when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(new URL('index.html', SCOPE).href, copy));
          // A page from the network may come from a new deployment: drop what it no longer uses.
          event.waitUntil(pruneSoon());
          return res;
        })
        .catch(() => caches.match(new URL('index.html', SCOPE).href)),
    );
    return;
  }

  // Hashed build assets (JS, CSS, fonts, the FFmpeg core) and the AI model parts, whose folder
  // name carries the model's hash, never change: cache first. Model parts go to their own cache,
  // so one copy is kept and app updates do not drop them.
  if (url.pathname.includes('/assets/') || url.pathname.includes('/models/')) {
    const target = url.pathname.includes('/models/') ? MODEL_CACHE : CACHE;
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(target).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else: stale while revalidate.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
