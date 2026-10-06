import { PermissionsAndroid, Platform } from 'react-native';
import {
  appendFile,
  CachesDirectoryPath,
  copyFile,
  DocumentDirectoryPath,
  DownloadDirectoryPath,
  exists,
  mkdir,
  moveFile,
  scanFile,
  unlink,
  writeFile,
} from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import type { ReceiverFs, SavedFile, ShareableFile } from './exportReceiver';
import {
  commonMime,
  fileUrl,
  joinPath,
  timestampedName,
  uniqueName,
} from './fileNames';

/** Private folder where files sit while the web page is still sending them. */
export const EXPORT_DIR = joinPath(CachesDirectoryPath, 'exports');

/** Android 10 and older need the storage permission to write into the shared Downloads folder. */
const LEGACY_STORAGE_MAX_API = 29;

export const receiverFs: ReceiverFs = {
  mkdir: path => mkdir(path),
  writeFile: (path, content, encoding) => writeFile(path, content, encoding),
  appendFile: (path, content, encoding) => appendFile(path, content, encoding),
  unlink: path => unlink(path),
};

/** Removes files left over from an earlier run: unfinished transfers and files that were shared. */
export async function clearExports(): Promise<void> {
  try {
    if (await exists(EXPORT_DIR)) await unlink(EXPORT_DIR);
  } catch {
    // Nothing to clear, or the system already cleared the cache.
  }
}

async function ensureLegacyWriteAccess(): Promise<void> {
  if (
    typeof Platform.Version !== 'number' ||
    Platform.Version > LEGACY_STORAGE_MAX_API
  )
    return;
  const permission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
  if (await PermissionsAndroid.check(permission)) return;
  const result = await PermissionsAndroid.request(permission);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('Allow storage access to save files to Downloads.');
  }
}

/**
 * Android: the shared Downloads folder, where the Files app and the gallery look. On Android 11
 * and newer an app may create its own files there without a permission, but it cannot see or
 * replace files other apps put there, so a name that looks free can still be refused. A second
 * name with the time in it covers that.
 */
async function saveToDownloads(
  tempPath: string,
  name: string,
  mime: string,
): Promise<SavedFile> {
  await ensureLegacyWriteAccess();
  const dir = DownloadDirectoryPath;
  await mkdir(dir).catch(() => undefined);
  const free = await uniqueName(name, candidate =>
    exists(joinPath(dir, candidate)),
  );
  let lastError: unknown = new Error(
    'The file could not be saved to Downloads.',
  );
  for (const candidate of [free, timestampedName(name, new Date())]) {
    const dest = joinPath(dir, candidate);
    try {
      await copyFile(tempPath, dest);
    } catch (error) {
      lastError = error;
      continue;
    }
    await unlink(tempPath).catch(() => undefined);
    // Tells the system about the new file so it shows up in the gallery and Files right away.
    await scanFile(dest).catch(() => null);
    return { name: candidate, place: 'Downloads', path: dest, mime };
  }
  throw lastError;
}

/** iOS: the app's Documents folder, which the Files app shows under "On My iPhone". */
async function saveToDocuments(
  tempPath: string,
  name: string,
  mime: string,
): Promise<SavedFile> {
  const dir = DocumentDirectoryPath;
  const free = await uniqueName(name, candidate =>
    exists(joinPath(dir, candidate)),
  );
  const dest = joinPath(dir, free);
  await moveFile(tempPath, dest);
  return { name: free, place: 'Files', path: dest, mime };
}

export function saveToDevice(
  tempPath: string,
  name: string,
  mime: string,
): Promise<SavedFile> {
  return Platform.OS === 'android'
    ? saveToDownloads(tempPath, name, mime)
    : saveToDocuments(tempPath, name, mime);
}

/** Opens the system share sheet. Closing the sheet without choosing an app is not an error. */
export async function shareFiles(
  files: ShareableFile[],
  text = '',
): Promise<void> {
  const message = text ? { message: text } : {};
  if (files.length === 0) {
    if (text) await Share.open({ failOnCancel: false, ...message });
    return;
  }
  const urls = files.map(f => fileUrl(f.path));
  const type = commonMime(files.map(f => f.mime));
  await Share.open(
    urls.length === 1
      ? { failOnCancel: false, type, url: urls[0], ...message }
      : { failOnCancel: false, type, urls, ...message },
  );
}
