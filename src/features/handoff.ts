import {
  BACKGROUND_INPUT_FORMATS,
  CLEAN_INPUT_FORMATS,
  CONVERT_INPUT_FORMATS,
  INPUT_FORMATS,
  RESIZE_INPUT_FORMATS,
  acceptAttribute,
  detectFormat,
  type FormatDef,
} from '../constants/formats';
import { CATALOG, type ToolId } from './catalog';
import { PDF_INPUT_FORMATS, addPdfFiles } from './pdf/intake';
import { TOOLS } from './tools';
import { TRIM_INPUT_FORMATS, loadTrimFile } from './trim/trimJob';

/** The files each tool accepts. */
const FORMATS: Record<ToolId, FormatDef[]> = {
  compress: INPUT_FORMATS,
  convert: CONVERT_INPUT_FORMATS,
  resize: RESIZE_INPUT_FORMATS,
  background: BACKGROUND_INPUT_FORMATS,
  trim: TRIM_INPUT_FORMATS,
  clean: CLEAN_INPUT_FORMATS,
  pdf: PDF_INPUT_FORMATS,
};

/** Accept list for a file picker that offers every format some tool can open. */
export const ANY_TOOL_ACCEPT = acceptAttribute(Object.values(FORMATS).flat());

export function acceptsFile(id: ToolId, file: File): boolean {
  return detectFormat(file, FORMATS[id]) !== null;
}

export interface ToolMatch {
  id: ToolId;
  /** The dropped files this tool can take. */
  files: File[];
}

/** Tools that can open at least one of the files, in catalog order. */
export function matchTools(files: File[]): ToolMatch[] {
  return CATALOG.map((tool) => ({ id: tool.id, files: files.filter((f) => acceptsFile(tool.id, f)) })).filter(
    (m) => m.files.length > 0,
  );
}

/** Hands files picked on the home page to a tool, as if they had been dropped on it. */
export function openToolWith(id: ToolId, files: File[]): void {
  if (id === 'trim') void loadTrimFile(files);
  else if (id === 'pdf') void addPdfFiles(files);
  else TOOLS[id].addFiles(files);
}
