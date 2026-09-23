# CompressKit

**Compress your media. Keep your privacy.**

CompressKit is a client-side web app that compresses images and videos directly in the browser. Files are never uploaded: decoding, encoding, previews and ZIP creation all happen on the user's device, inside Web Workers.

## Features

- **Images:** JPEG, PNG, WebP and AVIF in; JPEG, WebP, AVIF or PNG out. Quality control, optional resize (max width / height, never upscales), EXIF orientation respected, transparency preserved (a transparent image is never flattened into JPEG; it is saved as WebP, or PNG where WebP encoding is unavailable).
- **PNG optimization:** palette quantization (UPNG.js) below quality 90, lossless re-encoding at 90 and above.
- **AVIF everywhere:** native canvas AVIF encoding where the browser has it, otherwise a WebAssembly AVIF encoder (jSquash / libavif), loaded only when needed.
- **Videos:** MP4, MOV, WebM and MKV in; MP4 or WebM out. Codec, quality, resolution (short side cap, never upscales), frame rate cap and audio bitrate (or remove audio).
- **Two video engines:**
  - **WebCodecs** (via Mediabunny for demuxing and muxing): hardware accelerated, fast, streams the source file lazily.
  - **FFmpeg.wasm** (`@ffmpeg/core`, self-hosted): universal fallback, loaded lazily with real download progress.
  - *Automatic* mode tries WebCodecs first and falls back to FFmpeg per file.
- **Presets:** Maximum Quality, Balanced (default), Maximum Compression. Global settings plus per-file overrides.
- **Honest progress:** percentages only when they are measured (FFmpeg `time=` output against duration, Mediabunny conversion progress, engine download bytes). Otherwise the UI shows a processing state with the current stage.
- **Never makes files bigger silently:** if re-encoding in the same format would not reduce size, the original is kept and the UI says so.
- **Results:** before/after slider for images, synced side by side playback for videos, per-file stats (sizes, saving, dimensions, format, engine, time).
- **Downloads:** per file, or all files as a ZIP built in the browser (fflate, streamed, stored without recompression).
- **Cancellation:** per file or all, implemented by terminating the worker, which frees its memory immediately.
- Light, dark and system themes (persisted), responsive from 320 px, keyboard accessible, `prefers-reduced-motion` respected, installable PWA with an offline app shell.

## Tech stack

React 19, TypeScript, Vite 8, Tailwind CSS 4, Zustand 5, Framer Motion, Lucide React. Media: Canvas / OffscreenCanvas, `createImageBitmap`, WebCodecs, Mediabunny, FFmpeg.wasm (`@ffmpeg/core` 0.12), `@jsquash/avif`, `upng-js`, `fflate`.

No backend, no database, no external storage, no authentication, no analytics, no environment variables, no API keys.

## Getting started

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

```bash
npm run build     # type-check and production build into dist/
npm run preview   # serve the production build locally
npm run lint      # ESLint
```

## Architecture

```
React UI (components/)
    │  Zustand stores (store/): queue, settings, theme, capabilities, ui
    ▼
CompressionManager (features/compression/)
    │  schedules jobs, image worker pool + one video worker, cancellation, cleanup
    ▼
Web Workers (workers/)
    ├─ image.worker.ts  → features/image/encodeImage.ts (OffscreenCanvas, UPNG, jSquash AVIF)
    └─ video.worker.ts  → features/video/webcodecsEngine.ts (Mediabunny + WebCodecs)
                         → features/video/ffmpegEngine.ts   (FFmpeg.wasm core)
    ▼
progress / done / error messages → store → UI
```

```
src/
├── components/   layout, sections, upload, files, compression, settings, results, preview, common, workspace
├── features/     compression (manager, worker slots, intake, downloads), image, video
├── workers/      image.worker.ts, video.worker.ts
├── hooks/        theme, object URLs, queue summary
├── store/        queueStore, settingsStore, themeStore, capabilitiesStore, uiStore
├── utils/        browserSupport, mediaCapabilities, probe, zip, filename, format, errors
├── types/        media, settings, worker messages
└── constants/    formats, presets, error messages
```

Key decisions:

- **Workers own heavy work.** The UI thread only reads metadata (a detached `<video>` / `<img>` to read duration, dimensions and a small thumbnail).
- **Memory.** Queue thumbnails are small WebP renders, not full decodes. Full-size originals get an object URL only while a comparison is open. FFmpeg reads the source through `WORKERFS` (no copy into WebAssembly memory); WebCodecs reads it lazily through `BlobSource`. Object URLs are revoked on removal, replacement and clear. Idle workers are terminated (images after 20 s, video after 60 s), which releases WebAssembly heaps.
- **Rendering.** Each file card subscribes only to its own item; summary counters use shallow selectors; worker progress is throttled.
- **Errors.** Workers send error codes, the UI maps them to friendly messages (`constants/errors.ts`). Raw details only go to the console.

## FFmpeg.wasm

- The single-threaded `@ffmpeg/core` 0.12 is driven directly from `video.worker.ts` (no nested worker), using its current API (`exec`, `FS`, `setLogger`).
- The core JS and WASM files are imported with Vite's `?url`, so they are **served from your own origin**. Nothing is fetched from a CDN.
- It is only downloaded when the first video is compressed (about 32 MB, roughly 10 MB with gzip or brotli). Download progress is shown, and the browser / service worker caches it afterwards.
- Used encoders: **libx264** (MP4) and **libvpx VP8** (WebM), AAC and Opus audio. In testing, this core's libx265 hangs and its libvpx-vp9 crashes, so H.265, VP9 and AV1 are produced only through WebCodecs. If a browser cannot encode the chosen codec, Automatic mode falls back to H.264 (MP4) or VP8 (WebM) and tells the user.
- Quality maps to CRF (H.264 CRF about 20 / 24 / 29 for the three presets), with a `maxrate` cap derived from the source bitrate so already efficient files are not inflated.
- The multi-threaded core needs `SharedArrayBuffer` (COOP/COEP headers). It is intentionally not used so the app runs on any static host without special headers.

## WebCodecs

- Support is detected with `VideoEncoder.isConfigSupported` / `AudioEncoder.isConfigSupported` (`utils/mediaCapabilities.ts`) and re-checked per file in the worker with Mediabunny's `canEncodeVideo` / `canEncodeAudio` at the real output size.
- Nothing is assumed: if demuxing, decoding or encoding is unavailable for a file, the worker falls back to FFmpeg (Automatic mode) or reports a clear error (WebCodecs mode).
- Quality maps to a target bitrate (bits per pixel per frame, adjusted for codec efficiency) capped by the source bitrate.

## Privacy architecture

- Files are read with the File API and passed to workers by structured clone. There is no upload code path and no third-party request with user data.
- Engines (FFmpeg, AVIF encoder), fonts and icons are bundled and served from the same origin.
- `localStorage` only stores the theme and compression preferences.
- The service worker caches only the app's own static files.
- Re-encoded images drop EXIF metadata (canvas re-encode); videos are written without source metadata tags. Files that are kept as the original are returned byte for byte unchanged.
- Your hosting provider will still see normal page requests (like any website). CompressKit adds no analytics.

## Deployment

`npm run build` produces a static `dist/` folder. Deploy it to any static host (Netlify, Vercel, GitHub Pages, S3 + CloudFront, nginx).

- The FFmpeg WASM file is about 32 MB. Some hosts cap single files (for example Cloudflare Pages at 25 MiB). On such hosts, use a different host or serve that single asset from your own bucket on the same site.
- Enable gzip or brotli for `.wasm` to cut transfer size by about two thirds.
- Serve over HTTPS (required for service workers and some media APIs).
- For a sub-path deployment set `base` in `vite.config.ts` and update the paths in `index.html` and `public/manifest.webmanifest`.

## Browser compatibility

| Capability (approximate, check current release notes) | Chrome / Edge 114+ | Firefox 130+ | Safari 17+ |
| --- | --- | --- | --- |
| Image compression in workers (OffscreenCanvas) | Yes | Yes | Yes (16.4+) |
| WebP encoding | Yes | Yes | No, falls back to JPEG or PNG |
| AVIF encoding | Native or WebAssembly | WebAssembly | WebAssembly |
| WebCodecs video | Yes (codecs vary by OS and GPU) | Yes (codecs vary) | Partial, varies by version |
| FFmpeg.wasm fallback | Yes | Yes | Yes |

Older browsers without OffscreenCanvas fall back to main-thread image encoding. Module workers are required for video.

## Known limitations

- **FFmpeg.wasm is slow.** Single threaded software encoding runs far below real time for 1080p and above. Hardware WebCodecs is much faster where available.
- **Memory.** WebAssembly is limited to a few GB. Very long or high resolution videos can run out of memory, especially in the FFmpeg path. Files over 4 GB are rejected, and files over 1 GB are flagged.
- **Codec availability depends on the browser and OS.** For example, open source Chromium builds lack H.264 decoding, so MP4 input there goes through FFmpeg.
- **H.265 / VP9 / AV1** require WebCodecs support; otherwise the fallback codec is used.
- **Animated images** (animated WebP, APNG) are compressed as a single frame.
- **Previews:** the browser may not be able to preview some inputs (for example MKV or HEVC); compression can still work through FFmpeg.
- **HDR** video is converted to 8-bit SDR 4:2:0.

## Troubleshooting

- *"The video engine failed to load"*: check the network tab for the `ffmpeg-core-*.wasm` request; ensure your host serves `.wasm` files and does not block large files.
- *Video is very slow*: try the Automatic engine in a Chromium-based browser with hardware encoders, lower the resolution, or pick Maximum Compression (smaller output, but slower x264 preset).
- *"Your browser ran out of memory"*: close other tabs, lower the resolution, or split the video.
- *Stale version after deploying*: the service worker uses network-first for pages; a normal reload picks up the new build.
- *Port in use*: `npm run dev -- --port 3000`.

## Licensing note

`@ffmpeg/core` bundles FFmpeg with libx264 and is licensed **GPL-2.0-or-later**. Distributing a build that includes it carries GPL obligations. Review this before commercial distribution, or replace the FFmpeg fallback with a WebCodecs-only setup. Other dependencies are MIT, Apache-2.0 or MPL-2.0 licensed.
