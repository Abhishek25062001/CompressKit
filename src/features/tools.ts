import { createContext, useContext } from 'react';
import {
  BACKGROUND_INPUT_FORMATS,
  CLEAN_FORMAT_BADGES,
  CLEAN_INPUT_FORMATS,
  CONVERT_FORMAT_BADGES,
  CONVERT_INPUT_FORMATS,
  FORMAT_BADGES,
  INPUT_FORMATS,
  RESIZE_FORMAT_BADGES,
  RESIZE_INPUT_FORMATS,
  acceptAttribute,
} from '../constants/formats';
import { useBackgroundQueueStore, useCleanQueueStore, useConvertQueueStore, useQueueStore, useResizeQueueStore, type QueueStore } from '../store/queueStore';
import type { ToolMode, WorkspaceTab } from '../types/media';
import { BackgroundManager } from './background/backgroundManager';
import { CleanManager } from './clean/cleanManager';
import { compressionManager, conversionManager, resizeManager } from './compression/CompressionManager';
import { downloadAll, downloadItem } from './compression/downloads';
import { addFilesTo } from './compression/intake';

/** What the shared queue UI asks of the object that runs a tool's jobs. */
export interface QueueManager {
  start(): void;
  cancel(id: string): void;
  cancelAll(): void;
  remove(id: string): void;
  clear(): void;
  retry(id: string): void;
}

/** Everything the shared queue UI needs to drive one tool. */
export interface Tool {
  mode: ToolMode;
  useQueue: QueueStore;
  manager: QueueManager;
  addFiles: (files: Iterable<File>) => number;
  downloadItem: (id: string) => void;
  downloadAll: (onProgress?: (ratio: number) => void) => Promise<void>;
  accept: string;
  badges: string[];
  /** Words used in labels, e.g. "Compress 3 files", "Converting…". */
  verb: { base: string; ing: string; past: string; noun: string };
}

export const compressTool: Tool = {
  mode: 'compress',
  useQueue: useQueueStore,
  manager: compressionManager,
  addFiles: (files) => addFilesTo(useQueueStore, INPUT_FORMATS, files),
  downloadItem: (id) => downloadItem(useQueueStore, id),
  downloadAll: (onProgress) => downloadAll(useQueueStore, 'compresskit', onProgress),
  accept: acceptAttribute(INPUT_FORMATS),
  badges: FORMAT_BADGES,
  verb: { base: 'Compress', ing: 'Compressing', past: 'compressed', noun: 'Compression' },
};

export const convertTool: Tool = {
  mode: 'convert',
  useQueue: useConvertQueueStore,
  manager: conversionManager,
  addFiles: (files) => addFilesTo(useConvertQueueStore, CONVERT_INPUT_FORMATS, files),
  downloadItem: (id) => downloadItem(useConvertQueueStore, id),
  downloadAll: (onProgress) => downloadAll(useConvertQueueStore, 'compresskit-converted', onProgress),
  accept: acceptAttribute(CONVERT_INPUT_FORMATS),
  badges: CONVERT_FORMAT_BADGES,
  verb: { base: 'Convert', ing: 'Converting', past: 'converted', noun: 'Conversion' },
};

export const resizeTool: Tool = {
  mode: 'resize',
  useQueue: useResizeQueueStore,
  manager: resizeManager,
  addFiles: (files) => addFilesTo(useResizeQueueStore, RESIZE_INPUT_FORMATS, files),
  downloadItem: (id) => downloadItem(useResizeQueueStore, id),
  downloadAll: (onProgress) => downloadAll(useResizeQueueStore, 'compresskit-resized', onProgress),
  accept: acceptAttribute(RESIZE_INPUT_FORMATS),
  badges: RESIZE_FORMAT_BADGES,
  verb: { base: 'Resize', ing: 'Resizing', past: 'resized', noun: 'Resize' },
};

const cleanManager = new CleanManager(useCleanQueueStore);

export const cleanTool: Tool = {
  mode: 'clean',
  useQueue: useCleanQueueStore,
  manager: cleanManager,
  addFiles: (files) => {
    const added = addFilesTo(useCleanQueueStore, CLEAN_INPUT_FORMATS, files);
    // Read each new file right away, so its card can show what it hides before anything is removed.
    cleanManager.scan();
    return added;
  },
  downloadItem: (id) => downloadItem(useCleanQueueStore, id),
  downloadAll: (onProgress) => downloadAll(useCleanQueueStore, 'compresskit-clean', onProgress),
  accept: acceptAttribute(CLEAN_INPUT_FORMATS),
  badges: CLEAN_FORMAT_BADGES,
  verb: { base: 'Clean', ing: 'Cleaning', past: 'cleaned', noun: 'Cleaning' },
};

export const backgroundTool: Tool = {
  mode: 'background',
  useQueue: useBackgroundQueueStore,
  manager: new BackgroundManager(useBackgroundQueueStore),
  addFiles: (files) => addFilesTo(useBackgroundQueueStore, BACKGROUND_INPUT_FORMATS, files),
  downloadItem: (id) => downloadItem(useBackgroundQueueStore, id),
  downloadAll: (onProgress) => downloadAll(useBackgroundQueueStore, 'compresskit-cutouts', onProgress),
  accept: acceptAttribute(BACKGROUND_INPUT_FORMATS),
  badges: BACKGROUND_INPUT_FORMATS.map((f) => f.label),
  verb: { base: 'Cut out', ing: 'Cutting out', past: 'cut out', noun: 'Background removal' },
};

export const TOOLS: Record<ToolMode, Tool> = {
  compress: compressTool,
  convert: convertTool,
  resize: resizeTool,
  clean: cleanTool,
  background: backgroundTool,
};

export const ToolContext = createContext<Tool>(compressTool);

export function useTool(): Tool {
  return useContext(ToolContext);
}

/** Id of the hidden file input inside a tool's drop zone. */
export const fileInputId = (tab: WorkspaceTab) => `ck-file-input-${tab}`;
