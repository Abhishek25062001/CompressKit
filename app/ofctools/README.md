# ofctools

ofctools for Android and iOS: every tool of the website as an app (React Native 0.87, React Native CLI).

## How it works

The app ships the web project's production build and runs it on the phone:

- A small web server inside the app serves the build to a WebView from `http://127.0.0.1:47615`. It listens on this phone only. A real `http://` address is what lets the tools use script modules, workers, WebAssembly and WebCodecs the way they do in a browser.
- The app adds what a browser would otherwise do: saving results (Downloads on Android, the Files app on iOS), the share sheet, the Android Back button, opening outside links in the browser, and matching the status bar to the page's light or dark theme.

Files are processed on the device, as on the web. Nothing is uploaded.

| Path | What it holds |
| --- | --- |
| `App.tsx` | The frame around the tools: safe areas, status bar, startup and error screens |
| `src/web/` | Starting the server, the WebView, and the script that connects the page to the app |
| `src/files/` | Receiving files from the page, saving and sharing them |
| `src/ui/` | The native screens: startup, errors, the "Saved" notice |
| `scripts/sync-web.mjs` | Copies the web build into `webroot/web` |
| `webroot/` | The copied web build (not in git, about 90 MB) |

## Build and run

The web build has to be copied in before the app is built. Do this again whenever the web project changes.

```sh
npm install
npm run web:build   # builds the web project (../..) and copies it into webroot/web
```

`npm run web:sync` copies an existing `../../dist` without rebuilding it.

### Android

```sh
npm run android
```

The first build compiles the web server for each processor type and takes several minutes. To build only for the connected phone:

```sh
npm run android -- --active-arch-only
```

### iOS

The web server is compiled with CMake during the Xcode build:

```sh
brew install cmake pkg-config
cd ios && bundle install && bundle exec pod install
```

Then open `ios/ofctools.xcworkspace` in Xcode, choose your team under Signing & Capabilities, and run. If Xcode cannot find `cmake`, link it where Xcode looks:

```sh
sudo ln -s "$(which cmake)" /usr/local/bin/cmake
```

## Checks

```sh
npm run typecheck
npm run lint
npm test
```

The tests run the page-side script against a stand-in page and the real receiving code, so the file transfer between page and app is covered without a device. What they cannot cover is the device itself: the WebView, the server, file pickers, saving and sharing.

## Looking into a problem on a phone

- Debug builds log the WebView's abilities once per page load, and any error in the page, to the Metro console with a `[web]` prefix: secure context, WebCodecs, WebGPU and the WebView version.
- On Android, open `chrome://inspect` in desktop Chrome while the phone is connected to inspect the page itself.
