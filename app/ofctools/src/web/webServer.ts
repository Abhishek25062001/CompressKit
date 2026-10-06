import { Platform } from 'react-native';
import {
  copyFileAssets,
  DocumentDirectoryPath,
  exists,
  existsAssets,
  MainBundlePath,
  readFile,
  readFileAssets,
  stat,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs';
import Server, {
  getActiveServerId,
  STATES,
} from '@dr.pogodin/react-native-static-server';
import { joinPath } from '../files/fileNames';
import {
  describeUnpackProblems,
  findUnpackProblems,
  parseBuildFiles,
} from './buildFiles';
import { buildServerConfig } from './serverConfig';

/**
 * The web app (the project's `dist/` build) ships inside the app and is served to the WebView by
 * a small web server on this phone. A real `http://` address is what lets the page use script
 * modules, workers, WebAssembly and WebCodecs exactly as it does in a browser; none of those work
 * from a `file://` page. The server only listens on 127.0.0.1, so nothing outside the app can
 * reach it, and no file ever leaves the device.
 */

/** Folder of the web build inside the app's bundled assets. `npm run web:sync` fills it. */
const WEB_FOLDER = 'web';
/** Written by the sync script; changes whenever the web build does. */
const BUILD_ID_FILE = 'build-id.txt';
/** Written by the sync script: every file of the build with its size. */
const BUILD_FILES_FILE = 'build-files.json';
/** Holds the id of the build that was fully unpacked (Android). */
const READY_MARKER = 'web-ready.txt';

/**
 * A fixed port keeps the page's address the same between launches. The address is what the
 * WebView files saved settings under (theme, presets), so a changing port would reset them.
 */
const PREFERRED_PORT = 47615;

export type StartStage = 'checking' | 'unpacking' | 'starting';

export interface WebSite {
  /** E.g. "http://127.0.0.1:47615". */
  origin: string;
  buildId: string;
}

/** The app was built without the web build in it. */
export class WebBuildMissingError extends Error {
  constructor() {
    super('The web build is not included in this app build.');
    this.name = 'WebBuildMissingError';
  }
}

interface WebRoot {
  dir: string;
  buildId: string;
}

/**
 * Android keeps bundled assets inside the APK, where a web server cannot read them as files, so
 * they are copied out once per web build. The marker file is written last: if the app is closed
 * halfway through, the next launch sees no marker and starts the copy again.
 */
async function prepareAndroidRoot(
  onStage: (stage: StartStage) => void,
): Promise<WebRoot> {
  const bundledId = `${WEB_FOLDER}/${BUILD_ID_FILE}`;
  if (!(await existsAssets(bundledId))) throw new WebBuildMissingError();
  const buildId = (await readFileAssets(bundledId, 'utf8')).trim();

  const dir = joinPath(DocumentDirectoryPath, WEB_FOLDER);
  const marker = joinPath(DocumentDirectoryPath, READY_MARKER);
  let unpackedId = '';
  if (await exists(marker))
    unpackedId = (await readFile(marker, 'utf8')).trim();

  if (unpackedId !== buildId || !(await exists(joinPath(dir, 'index.html')))) {
    onStage('unpacking');
    if (await exists(marker)) await unlink(marker);
    if (await exists(dir)) await unlink(dir);
    await copyFileAssets(WEB_FOLDER, dir);
    await verifyUnpacked(dir);
    await writeFile(marker, buildId, 'utf8');
  }
  return { dir, buildId };
}

/** Checks the unpacked folder against the build's own file list, and says which file is wrong. */
async function verifyUnpacked(dir: string): Promise<void> {
  const listFile = joinPath(dir, BUILD_FILES_FILE);
  if (!(await exists(listFile))) return;
  const files = parseBuildFiles(await readFile(listFile, 'utf8'));
  if (!files) return;
  const problems = await findUnpackProblems(files, async path => {
    try {
      return (await stat(joinPath(dir, path))).size;
    } catch {
      return null;
    }
  });
  if (problems.length > 0) throw new Error(describeUnpackProblems(problems));
}

/** iOS can serve the folder straight from the app bundle. */
async function prepareIosRoot(): Promise<WebRoot> {
  const dir = joinPath(MainBundlePath ?? '', WEB_FOLDER);
  const idFile = joinPath(dir, BUILD_ID_FILE);
  if (!(await exists(idFile))) throw new WebBuildMissingError();
  return { dir, buildId: (await readFile(idFile, 'utf8')).trim() };
}

let server: Server | null = null;
let crashListener: ((details: string) => void) | null = null;

/** Called when the server stops unexpectedly after it was running. */
export function onWebServerCrash(
  listener: ((details: string) => void) | null,
): void {
  crashListener = listener;
}

/**
 * A reload of the app's JavaScript (in development) leaves the native server running with no
 * object on this side that knows about it, and only one server may run at a time. This takes
 * hold of such a leftover and stops it.
 */
async function stopLeftoverServer(fileDir: string): Promise<void> {
  const id = await getActiveServerId();
  if (id === null || id === undefined) return;
  await new Server({ fileDir, id, state: STATES.ACTIVE }).stop();
}

async function startServer(fileDir: string): Promise<string> {
  const config = buildServerConfig();
  // The preferred port, then any free port, then any free port with the server's own defaults in
  // case a setting of ours is what it refuses.
  const attempts: Array<{ port: number; extraConfig: string }> = [
    { port: PREFERRED_PORT, extraConfig: config },
    { port: 0, extraConfig: config },
    { port: 0, extraConfig: '' },
  ];
  let lastError: unknown = new Error('The local server could not start.');
  for (const attempt of attempts) {
    const candidate = new Server({
      fileDir,
      port: attempt.port,
      extraConfig: attempt.extraConfig,
      // iOS closes a suspended app's listening socket, so there the server stops with the app
      // and starts again on return. On Android it keeps running, which matters while the system
      // file picker is in front of the app.
      stopInBackground: Platform.OS === 'ios',
    });
    try {
      const origin = await candidate.start();
      server = candidate;
      candidate.addStateListener((state, details) => {
        if (state === STATES.CRASHED && server === candidate)
          crashListener?.(details);
      });
      return origin;
    } catch (error) {
      lastError = error;
      await candidate.stop().catch(() => undefined);
    }
  }
  throw lastError;
}

let starting: Promise<WebSite> | null = null;

async function start(onStage: (stage: StartStage) => void): Promise<WebSite> {
  onStage('checking');
  const root =
    Platform.OS === 'android'
      ? await prepareAndroidRoot(onStage)
      : await prepareIosRoot();
  onStage('starting');
  if (server) {
    await server.stop().catch(() => undefined);
    server = null;
  }
  await stopLeftoverServer(root.dir).catch(() => undefined);
  const origin = await startServer(root.dir);
  return { origin, buildId: root.buildId };
}

/**
 * Makes the web build available and returns its address. Calls made while a start is under way
 * share it; a call after a failure, or with `restart`, starts over.
 */
export function startWebSite(
  onStage: (stage: StartStage) => void,
  restart = false,
): Promise<WebSite> {
  if (!starting || restart) {
    const attempt = start(onStage);
    starting = attempt;
    attempt.catch(() => {
      if (starting === attempt) starting = null;
    });
  }
  return starting;
}
