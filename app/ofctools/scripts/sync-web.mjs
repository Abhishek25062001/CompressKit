// Copies the web app's production build into this app, so it ships inside the APK / IPA.
//
//   node scripts/sync-web.mjs            copies ../../dist
//   node scripts/sync-web.mjs <folder>   copies another build folder
//
// The copy lands in webroot/web. Android packs webroot/ as assets (android/app/build.gradle) and
// Xcode copies webroot/web into the app bundle (a folder reference in the project). Run this
// after every web build, then build the app again.
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.argv[2] ?? join(appRoot, '..', '..', 'dist'));
const target = join(appRoot, 'webroot', 'web');

// Left out of the app:
//  - sw.js: the service worker stores files for offline use in a browser. Here every file is
//    already on the phone, so it would only keep a second copy of each one.
//  - robots.txt and og-image.png are for search engines and link previews.
const SKIP = new Set(['sw.js', 'robots.txt', 'og-image.png', '.DS_Store']);

if (!existsSync(join(source, 'index.html'))) {
  console.error(
    `No web build found at ${source}.\nRun "npm run build" in the web project first (or "npm run web:build" here, which does both).`,
  );
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, {
  recursive: true,
  filter: from => !SKIP.has(from.split(sep).pop() ?? ''),
});

/** Every file under `dir`, as paths relative to it, in a stable order. */
function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(entry =>
      entry.isDirectory()
        ? listFiles(join(dir, entry.name), base)
        : [relative(base, join(dir, entry.name)).split(sep).join('/')],
    )
    .sort();
}

// Android's build tools unzip every ".gz" asset and drop the ending while packing the APK, so a
// gzipped file would reach the phone under another name. Such files are unzipped here instead,
// which gives both apps the same files; the APK and IPA compress them again anyway. Inside the
// app the web build asks for the unzipped name (see gzip in ../../src/features/pdf/ocr.ts).
for (const file of listFiles(target).filter(name => name.endsWith('.gz'))) {
  const zipped = join(target, file);
  writeFileSync(zipped.slice(0, -'.gz'.length), gunzipSync(readFileSync(zipped)));
  rmSync(zipped);
  console.log(`Unzipped ${file}`);
}

const files = listFiles(target);
let bytes = 0;
const sizes = [];
const hash = createHash('sha256');
for (const file of files) {
  const size = statSync(join(target, file)).size;
  bytes += size;
  sizes.push([file, size]);
  // Names of built files carry a hash of their contents, so names and sizes identify the build;
  // the pages are small, so their contents are hashed too.
  hash.update(`${file}:${size}\n`);
  if (file.endsWith('.html')) hash.update(readFileSync(join(target, file)));
}
const buildId = hash.digest('hex').slice(0, 16);

// The app compares this with the copy it unpacked earlier to know when to unpack again.
writeFileSync(join(target, 'build-id.txt'), `${buildId}\n`);
// After unpacking, the app checks every file against this list (path and size).
writeFileSync(join(target, 'build-files.json'), JSON.stringify(sizes));

console.log(
  `Web build ${buildId}: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(
    1,
  )} MB → ${relative(appRoot, target)}`,
);
