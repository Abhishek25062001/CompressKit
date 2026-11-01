import type { PageTextLine } from '../docs/pdfExtract';
import type { PageEdit, PdfPage, PdfSource } from '../../types/pdf';
import { createId } from '../../utils/id';
import { getOpenPdf } from './documents';
import { refreshThumbnail } from './intake';
import { usePdfStore } from '../../store/pdfStore';

export type BulkMode = 'text' | 'number';
export type NumberOperation = 'add' | 'subtract' | 'set';

export interface BulkSearchOptions {
  mode: BulkMode;
  query: string;
  replacement: string;
  numberOp: NumberOperation;
  numberDelta: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: 'all' | 'selected';
  findAllNumbers?: boolean;
}

export interface BulkMatchOccurrence {
  id: string;
  pageId: string;
  pageIndex: number;
  pageNumber: number;
  lineIndex: number;
  originalLineText: string;
  matchedText: string;
  replacementText: string;
  startIndex: number;
  endIndex: number;
  line: PageTextLine;
  existingEditId?: string;
  selected: boolean;
}

/** Cache extracted lines per page (key: `${page.id}_${page.rotation}`). */
const pageLinesCache = new Map<string, PageTextLine[]>();

export function clearPageLinesCache(pageId?: string): void {
  if (pageId) {
    for (const key of pageLinesCache.keys()) {
      if (key.startsWith(pageId)) pageLinesCache.delete(key);
    }
  } else {
    pageLinesCache.clear();
  }
}

/** Extracts text lines for a page, using cache if available. */
export async function getOrExtractPageLines(page: PdfPage, source?: PdfSource): Promise<PageTextLine[]> {
  const cacheKey = `${page.id}_${page.rotation}`;
  const cached = pageLinesCache.get(cacheKey);
  if (cached) return cached;

  const resolvedSource = source ?? usePdfStore.getState().sources[page.sourceId];
  if (!resolvedSource || resolvedSource.kind !== 'pdf') {
    return [];
  }

  try {
    const [{ pageTextLines }, pdfDoc] = await Promise.all([
      import('../docs/pdfExtract'),
      getOpenPdf(resolvedSource.id).view.getPage(page.index + 1),
    ]);
    const lines = await pageTextLines(pdfDoc, page.rotation);
    pageLinesCache.set(cacheKey, lines);
    return lines;
  } catch (err) {
    console.warn(`[bulkEdit] Failed to extract lines for page ${page.id}:`, err);
    return [];
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Computes the replacement number string while preserving decimal formatting. */
export function computeNumberReplacement(
  matchedText: string,
  op: NumberOperation,
  delta: number,
): string {
  const numVal = parseFloat(matchedText);
  if (Number.isNaN(numVal)) return matchedText;

  let resultNum: number;
  if (op === 'add') {
    resultNum = numVal + delta;
  } else if (op === 'subtract') {
    resultNum = numVal - delta;
  } else {
    resultNum = delta;
  }

  // Preserve decimal precision if either original text or delta had decimals
  const matchDecimals = matchedText.includes('.') ? (matchedText.split('.')[1] || '').length : 0;
  const deltaStr = String(delta);
  const deltaDecimals = deltaStr.includes('.') ? (deltaStr.split('.')[1] || '').length : 0;
  const maxDecimals = Math.max(matchDecimals, deltaDecimals);

  if (maxDecimals > 0) {
    return resultNum.toFixed(maxDecimals);
  }
  return String(Math.round(resultNum));
}

/** Finds all matching occurrences on a single page given lines and existing edits. */
export function findMatchesInPageLines(
  page: PdfPage,
  pageIndex: number,
  lines: PageTextLine[],
  options: BulkSearchOptions,
): BulkMatchOccurrence[] {
  const matches: BulkMatchOccurrence[] = [];
  const existingEdits = page.edits ?? [];

  // Helper to test if a base line is already covered by an existing text edit with background
  const isLineCovered = (line: PageTextLine) =>
    existingEdits.some(
      (e) =>
        e.kind === 'text' &&
        e.background &&
        Math.abs(e.y - line.y) < Math.max(line.size, 0.015) &&
        e.x <= line.x + 0.05,
    );

  // Targets to scan:
  // 1. Uncovered base lines from the PDF document
  // 2. Existing text edits (which represent current text on the page)
  interface ScanTarget {
    text: string;
    line: PageTextLine;
    lineIndex: number;
    existingEditId?: string;
  }

  const targets: ScanTarget[] = [];

  lines.forEach((l, idx) => {
    if (!isLineCovered(l)) {
      targets.push({ text: l.text, line: l, lineIndex: idx });
    }
  });

  existingEdits.forEach((ed, idx) => {
    if (ed.kind === 'text' && ed.text.trim()) {
      targets.push({
        text: ed.text,
        line: {
          text: ed.text,
          x: ed.x,
          y: ed.y,
          width: ed.width,
          height: ed.coverHeight ?? ed.size * 1.25,
          size: ed.size,
          bold: ed.bold,
          italic: ed.italic,
          font: ed.font,
        },
        lineIndex: 10000 + idx,
        existingEditId: ed.id,
      });
    }
  });

  if (options.mode === 'text') {
    const q = options.query;
    if (!q) return [];

    const escaped = escapeRegExp(q);
    const pattern = options.wholeWord ? `\\b${escaped}\\b` : escaped;
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
    } catch {
      return [];
    }

    for (const t of targets) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(t.text)) !== null) {
        if (!m[0]) {
          regex.lastIndex++;
          continue;
        }
        matches.push({
          id: `${page.id}-${t.lineIndex}-${m.index}`,
          pageId: page.id,
          pageIndex,
          pageNumber: pageIndex + 1,
          lineIndex: t.lineIndex,
          originalLineText: t.text,
          matchedText: m[0],
          replacementText: options.replacement,
          startIndex: m.index,
          endIndex: m.index + m[0].length,
          line: t.line,
          existingEditId: t.existingEditId,
          selected: true,
        });
      }
    }
  } else {
    // Number mode
    const numQ = options.query.trim();
    let regex: RegExp;

    if (options.findAllNumbers || !numQ) {
      // Find all standalone numbers (including negative and floating point)
      regex = /(?<![\w])-?\d+(?:\.\d+)?(?![\w])/g;
    } else {
      // Find specific number
      const escapedNum = escapeRegExp(numQ);
      regex = new RegExp(`(?<![\\d.])${escapedNum}(?![\\d.])`, 'g');
    }

    for (const t of targets) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(t.text)) !== null) {
        if (!m[0]) {
          regex.lastIndex++;
          continue;
        }
        const repl = computeNumberReplacement(m[0], options.numberOp, options.numberDelta);
        matches.push({
          id: `${page.id}-${t.lineIndex}-${m.index}`,
          pageId: page.id,
          pageIndex,
          pageNumber: pageIndex + 1,
          lineIndex: t.lineIndex,
          originalLineText: t.text,
          matchedText: m[0],
          replacementText: repl,
          startIndex: m.index,
          endIndex: m.index + m[0].length,
          line: t.line,
          existingEditId: t.existingEditId,
          selected: true,
        });
      }
    }
  }

  return matches;
}

/** Scans all specified pages in the PDF for matching occurrences. */
export async function scanPdfForMatches(
  pages: PdfPage[],
  sources: Record<string, PdfSource>,
  options: BulkSearchOptions,
  onProgress?: (progress: number, pageNum: number) => void,
): Promise<BulkMatchOccurrence[]> {
  const allMatches: BulkMatchOccurrence[] = [];
  const targetPages = options.scope === 'selected'
    ? pages.filter((p) => p.selected)
    : pages;

  for (let i = 0; i < targetPages.length; i++) {
    const page = targetPages[i];
    const source = sources[page.sourceId];
    onProgress?.((i + 1) / targetPages.length, i + 1);

    const lines = await getOrExtractPageLines(page, source);
    const pageMatches = findMatchesInPageLines(page, i, lines, options);
    allMatches.push(...pageMatches);
  }

  return allMatches;
}

/** Applies bulk replacements across the PDF, recording an undo snapshot. */
export function applyBulkMatches(
  pages: PdfPage[],
  matchesToApply: BulkMatchOccurrence[],
  description: string,
): number {
  if (!matchesToApply.length) return 0;

  // Snapshot before making changes
  const backup: Record<string, PageEdit[] | undefined> = {};
  pages.forEach((p) => {
    backup[p.id] = p.edits ? JSON.parse(JSON.stringify(p.edits)) : undefined;
  });

  // Group matches by pageId
  const byPage = new Map<string, BulkMatchOccurrence[]>();
  for (const m of matchesToApply) {
    const list = byPage.get(m.pageId) ?? [];
    list.push(m);
    byPage.set(m.pageId, list);
  }

  for (const [pageId, pageMatches] of byPage.entries()) {
    const page = pages.find((p) => p.id === pageId);
    if (!page) continue;

    let currentEdits: PageEdit[] = [...(page.edits ?? [])];

    // Group page matches by target: existingEditId or lineIndex
    const byTarget = new Map<string, BulkMatchOccurrence[]>();
    for (const m of pageMatches) {
      const key = m.existingEditId ? `edit:${m.existingEditId}` : `line:${m.lineIndex}`;
      const group = byTarget.get(key) ?? [];
      group.push(m);
      byTarget.set(key, group);
    }

    for (const [targetKey, targetMatches] of byTarget.entries()) {
      // Sort matches in reverse order of startIndex so index replacement does not shift later indices
      const sorted = [...targetMatches].sort((a, b) => b.startIndex - a.startIndex);
      const first = sorted[0];

      let updatedText = first.originalLineText;
      for (const m of sorted) {
        updatedText =
          updatedText.slice(0, m.startIndex) +
          m.replacementText +
          updatedText.slice(m.endIndex);
      }

      if (targetKey.startsWith('edit:')) {
        const editId = targetKey.slice(5);
        currentEdits = currentEdits.map((ed) => {
          if (ed.id === editId && ed.kind === 'text') {
            const charRatio = ed.text.length > 0 ? updatedText.length / ed.text.length : 1;
            const width = charRatio > 1 ? Math.max(ed.width, ed.width * charRatio) : ed.width;
            return { ...ed, text: updatedText, width };
          }
          return ed;
        });
      } else {
        const line = first.line;
        const bg = '#ffffff';
        const charRatio = line.text.length > 0 ? updatedText.length / line.text.length : 1;
        const width = Math.max(line.width + 0.02, (line.width + 0.02) * Math.max(1, charRatio));

        const newEdit: PageEdit = {
          id: createId(),
          kind: 'text',
          x: Math.max(0, line.x - 0.002),
          y: line.y,
          width,
          text: updatedText,
          size: line.size,
          color: '#000000',
          bold: line.bold,
          italic: line.italic,
          font: line.font,
          align: 'left',
          background: bg,
          coverHeight: line.height,
          coverWidth: line.width + 0.006,
        };

        currentEdits.push(newEdit);
      }
    }

    usePdfStore.getState().updatePage(pageId, { edits: currentEdits });
    refreshThumbnail(pageId);
  }

  usePdfStore.getState().setLastBulkEdit({
    description,
    affectedCount: matchesToApply.length,
    pageEditsBackup: backup,
  });

  return matchesToApply.length;
}
