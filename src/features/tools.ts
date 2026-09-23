import { createContext, useContext } from 'react';
import {
  CONVERT_FORMAT_BADGES,
  CONVERT_INPUT_FORMATS,
  FORMAT_BADGES,
  INPUT_FORMATS,
  RESIZE_FORMAT_BADGES,
  RESIZE_INPUT_FORMATS,
  acceptAttribute,
} from '../constants/formats';
import { useConvertQueueStore, useQueueStore, useResizeQueueStore, type QueueStore } from '../store/queueStore';
import type { ToolMode, WorkspaceTab } from '../types/media';
import {
  compressionManager,
  conversionManager,
  resizeManager,
  type CompressionManager,
} from './compression/CompressionManager';
import { downloadAll, downloadItem } from './compression/downloads';
import { addFilesTo } from './compression/intake';

/** Everything the shared queue UI needs to drive one tool. */
export interface Tool {
  mode: ToolMode;
  useQueue: QueueStore;
  manager: CompressionManager;
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

export const TOOLS: Record<ToolMode, Tool> = { compress: compressTool, convert: convertTool, resize: resizeTool };

export const ToolContext = createContext<Tool>(compressTool);

export function useTool(): Tool {
  return useContext(ToolContext);
}

/** Id of the hidden file input inside a tool's drop zone. */
export const fileInputId = (tab: WorkspaceTab) => `ck-file-input-${tab}`;
