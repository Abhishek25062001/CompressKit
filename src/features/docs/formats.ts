import type { FormatDef } from '../../constants/formats';

/**
 * Document formats the converters read, kept apart from the readers themselves so that checking a
 * dropped file does not load a parser.
 */

export const TEXT_FORMAT: FormatDef = {
  kind: 'image',
  label: 'TXT',
  mimes: ['text/plain'],
  extensions: ['txt', 'text', 'log', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf'],
};
export const MARKDOWN_FORMAT: FormatDef = { kind: 'image', label: 'MD', mimes: ['text/markdown', 'text/x-markdown'], extensions: ['md', 'markdown', 'mdown', 'mkd'] };
export const RTF_FORMAT: FormatDef = { kind: 'image', label: 'RTF', mimes: ['application/rtf', 'text/rtf'], extensions: ['rtf'] };
export const HTML_FORMAT: FormatDef = { kind: 'image', label: 'HTML', mimes: ['text/html', 'application/xhtml+xml'], extensions: ['html', 'htm', 'xhtml'] };

const matches = (file: File, format: FormatDef) =>
  format.mimes.includes(file.type) || format.extensions.some((ext) => file.name.toLowerCase().endsWith(`.${ext}`));

export const isMarkdown = (file: File) => matches(file, MARKDOWN_FORMAT);
export const isPlainText = (file: File) => matches(file, TEXT_FORMAT) || isMarkdown(file);
export const isRtf = (file: File) => matches(file, RTF_FORMAT);
export const isHtml = (file: File) => matches(file, HTML_FORMAT);
