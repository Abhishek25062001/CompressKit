import type { PageTextLine, TextPieceInfo } from '../docs/pdfExtract';
import type { PageEdit, PdfPage, PdfSource } from '../../types/pdf';
import { createId } from '../../utils/id';
import { getOpenPdf } from './documents';
import { refreshThumbnail } from './intake';
import { usePdfStore } from '../../store/pdfStore';

export type BulkMode = 'text' | 'transaction' | 'number';
export type NumberOperation = 'add' | 'subtract' | 'set';
export type TransactionDirection = 'auto' | 'credit' | 'debit';

export interface FinancialFormat {
  raw: string;
  prefix: string; // e.g. "₹", "$", "Rs. "
  suffix: string; // e.g. "/-", " CR"
  hasCommas: boolean;
  decimals: number;
  number: number;
}

export interface BulkSearchOptions {
  mode: BulkMode;
  query: string; // text to find, or amount to find
  replacement: string; // for text mode
  // Transaction mode specific options
  contextFilter?: string; // e.g. "Student Fees" or "Fees"
  transactionDirection: TransactionDirection; // auto / credit / debit
  newAmount?: number; // target new amount, e.g. 3500
  adjustBy?: number; // delta difference, e.g. +400 or -600
  updateBalances: boolean; // whether to find and update dependent balances
  // Generic number mode options
  numberOp: NumberOperation;
  numberDelta: number;
  findAllNumbers?: boolean;
  // Common options
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: 'all' | 'selected';
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
  piece?: TextPieceInfo; // piece-level precision if available
  existingEditId?: string;
  selected: boolean;
  // Financial & transactional metadata
  isTransaction?: boolean;
  isDependentBalance?: boolean;
  direction?: 'credit' | 'debit';
  delta?: number;
  contextTag?: string; // e.g. "Student Fees" or "Related Balance"
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

/** Parses financial formats like "₹3,100", "$10,000.50", "Rs. 2500/-", etc. */
export function parseFinancialValue(str: string): FinancialFormat | null {
  const match = /^\s*([^\d\s\-+]*?)\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*([^\d\s]*)\s*$/.exec(str);
  if (!match) return null;

  const prefix = match[1] || '';
  const numStr = match[2] || '';
  const suffix = match[3] || '';
  const cleanNumStr = numStr.replace(/,/g, '');
  const number = parseFloat(cleanNumStr);
  if (Number.isNaN(number)) return null;

  const hasCommas = numStr.includes(',');
  const decimals = cleanNumStr.includes('.') ? (cleanNumStr.split('.')[1] || '').length : 0;

  return {
    raw: str,
    prefix,
    suffix,
    hasCommas,
    decimals,
    number,
  };
}

/** Formats a numeric value using the original financial string's template (currency, commas, decimals). */
export function formatFinancialValue(val: number, template: FinancialFormat): string {
  const absVal = Math.abs(val);
  const fixedStr = template.decimals > 0 ? absVal.toFixed(template.decimals) : String(Math.round(absVal));
  const [intPart, decPart] = fixedStr.split('.');

  let formattedInt = intPart;
  if (template.hasCommas) {
    // If prefix is Indian Rupee ₹ or Rs, format with Indian numbering system (e.g. 1,00,000)
    const isIndian = /₹|rs/i.test(template.prefix);
    if (isIndian && intPart.length > 3) {
      const lastThree = intPart.substring(intPart.length - 3);
      const otherNumbers = intPart.substring(0, intPart.length - 3);
      formattedInt = `${otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`;
    } else {
      formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
  }

  const sign = val < 0 ? '-' : '';
  const numFormatted = decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
  return `${sign}${template.prefix}${numFormatted}${template.suffix}`;
}

/** Detects if context implies a Credit/Income vs Debit/Expense. */
export function detectTransactionDirection(text: string): 'credit' | 'debit' {
  const creditKeywords = /\b(fee|fees|income|credit|cr|deposit|receipt|received|sales|salary|bonus|inflow|\+)\b/i;
  const debitKeywords = /\b(expense|expenses|debit|dr|payment|paid|withdrawal|outflow|charge|concession|discount|tax|deducted|refund|-)\b/i;

  if (debitKeywords.test(text)) return 'debit';
  if (creditKeywords.test(text)) return 'credit';
  return 'credit'; // Default to credit / addition
}

/** Checks if a line is likely an unrelated reference, account number, or date. */
export function isUnrelatedContext(text: string): boolean {
  return /\b(account\s*(?:no|num|#)?|a\/c|ref|reference|invoice\s*(?:no|#)?|phone|mobile|pin|code|roll\s*(?:no|#)?|date|dob)\b/i.test(text);
}

/** Checks if a line is a balance or total line. */
export function isBalanceOrTotalLine(text: string): boolean {
  return /\b(balance|closing balance|net balance|total balance|current balance|total|total amount|grand total|subtotal|net amount|amount payable|amount due|remaining amount)\b/i.test(
    text,
  );
}

/** Finds the best matching piece in a line for a given substring match. */
function findPieceForMatch(line: PageTextLine, startIndex: number, matchedText: string): TextPieceInfo | undefined {
  if (!line.pieces?.length) return undefined;

  // Check if a single piece contains the matched text
  const direct = line.pieces.find((p) => p.text.includes(matchedText));
  if (direct) return direct;

  // Approximate by text position
  let runningLen = 0;
  for (const p of line.pieces) {
    if (startIndex >= runningLen && startIndex <= runningLen + p.text.length) {
      return p;
    }
    runningLen += p.text.length + 1;
  }
  return line.pieces[0];
}

/** Finds all matching occurrences on a single page. */
export function findMatchesInPageLines(
  page: PdfPage,
  pageIndex: number,
  lines: PageTextLine[],
  options: BulkSearchOptions,
): BulkMatchOccurrence[] {
  const matches: BulkMatchOccurrence[] = [];
  const existingEdits = page.edits ?? [];

  const isLineCovered = (line: PageTextLine) =>
    existingEdits.some(
      (e) =>
        e.kind === 'text' &&
        e.background &&
        Math.abs(e.y - line.y) < Math.max(line.size, 0.015) &&
        e.x <= line.x + 0.05,
    );

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
          fontFamily: ed.fontFamily,
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
        const piece = findPieceForMatch(t.line, m.index, m[0]);
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
          piece,
          existingEditId: t.existingEditId,
          selected: true,
        });
      }
    }
  } else if (options.mode === 'transaction') {
    // Transaction Mode: smart financial value search and balance awareness
    const queryStr = options.query.trim();
    if (!queryStr) return [];

    // Parse the query to understand numeric amount and optional currency symbol
    const parsedQuery = parseFinancialValue(queryStr);
    const targetNum = parsedQuery ? parsedQuery.number : parseFloat(queryStr.replace(/[^\d.]/g, ''));
    if (Number.isNaN(targetNum)) return [];

    // Find occurrences of this amount in the lines
    // Pattern to match currency/number tokens: e.g. ₹3,100 or 3,100 or 3100
    const numRegex = /(?:[₹$€£]|Rs\.?|INR)?\s*[-+]?\d[\d,]*(?:\.\d+)?(?:\s*\/-)?/gi;

    let transactionMatch: BulkMatchOccurrence | null = null;
    let computedDelta = 0;

    for (const t of targets) {
      // If context filter is specified (e.g. "Student Fees"), check line relevance
      if (options.contextFilter && options.contextFilter.trim()) {
        const filterRegex = new RegExp(escapeRegExp(options.contextFilter.trim()), 'i');
        if (!filterRegex.test(t.text)) continue;
      }

      // Check if this line is an unrelated ID/Account number unless explicitly asked
      if (!options.contextFilter && isUnrelatedContext(t.text)) {
        continue;
      }

      numRegex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = numRegex.exec(t.text)) !== null) {
        const token = m[0].trim();
        const parsedToken = parseFinancialValue(token);
        if (!parsedToken) continue;

        if (Math.abs(parsedToken.number - targetNum) < 0.001) {
          // Found matching transaction amount
          const piece = findPieceForMatch(t.line, m.index, token);

          // Determine direction
          const dir =
            options.transactionDirection === 'auto'
              ? detectTransactionDirection(t.text)
              : options.transactionDirection;

          // Calculate new amount and delta
          let newAmount: number;
          if (options.newAmount !== undefined) {
            newAmount = options.newAmount;
            computedDelta = newAmount - parsedToken.number;
          } else if (options.adjustBy !== undefined) {
            computedDelta = options.adjustBy;
            newAmount = parsedToken.number + computedDelta;
          } else {
            newAmount = parsedToken.number;
            computedDelta = 0;
          }

          const replacementText = formatFinancialValue(newAmount, parsedToken);

          transactionMatch = {
            id: `${page.id}-${t.lineIndex}-${m.index}`,
            pageId: page.id,
            pageIndex,
            pageNumber: pageIndex + 1,
            lineIndex: t.lineIndex,
            originalLineText: t.text,
            matchedText: token,
            replacementText,
            startIndex: m.index,
            endIndex: m.index + m[0].length,
            line: t.line,
            piece,
            existingEditId: t.existingEditId,
            selected: true,
            isTransaction: true,
            direction: dir,
            delta: computedDelta,
            contextTag: t.text.slice(0, 30).trim(),
          };
          matches.push(transactionMatch);
          break;
        }
      }
      if (transactionMatch) break;
    }

    // If transaction found and updateBalances is enabled, find related balance and total lines!
    if (transactionMatch && options.updateBalances && Math.abs(computedDelta) > 0.0001) {
      const balanceChange =
        transactionMatch.direction === 'debit' ? -computedDelta : computedDelta;

      for (const t of targets) {
        // Skip the transaction line itself
        if (t.lineIndex === transactionMatch.lineIndex) continue;

        if (isBalanceOrTotalLine(t.text)) {
          numRegex.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = numRegex.exec(t.text)) !== null) {
            const token = m[0].trim();
            const parsedToken = parseFinancialValue(token);
            if (!parsedToken) continue;

            const updatedBal = parsedToken.number + balanceChange;
            const replacementText = formatFinancialValue(updatedBal, parsedToken);
            const piece = findPieceForMatch(t.line, m.index, token);

            matches.push({
              id: `${page.id}-${t.lineIndex}-${m.index}-dep`,
              pageId: page.id,
              pageIndex,
              pageNumber: pageIndex + 1,
              lineIndex: t.lineIndex,
              originalLineText: t.text,
              matchedText: token,
              replacementText,
              startIndex: m.index,
              endIndex: m.index + m[0].length,
              line: t.line,
              piece,
              existingEditId: t.existingEditId,
              selected: true,
              isDependentBalance: true,
              delta: balanceChange,
              contextTag: `Related: ${t.text.split(/[:\t-]/)[0]?.trim() || 'Balance'}`,
            });
          }
        }
      }
    }
  } else {
    // Number Mode (direct increment/decrement on numbers)
    const numQ = options.query.trim();
    let regex: RegExp;

    if (options.findAllNumbers || !numQ) {
      regex = /(?<![\w])-?\d+(?:\.\d+)?(?![\w])/g;
    } else {
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

        const numVal = parseFloat(m[0]);
        let resultNum: number;
        if (options.numberOp === 'add') {
          resultNum = numVal + options.numberDelta;
        } else if (options.numberOp === 'subtract') {
          resultNum = numVal - options.numberDelta;
        } else {
          resultNum = options.numberDelta;
        }

        const matchDecimals = m[0].includes('.') ? (m[0].split('.')[1] || '').length : 0;
        const deltaStr = String(options.numberDelta);
        const deltaDecimals = deltaStr.includes('.') ? (deltaStr.split('.')[1] || '').length : 0;
        const maxDecimals = Math.max(matchDecimals, deltaDecimals);

        const repl = maxDecimals > 0 ? resultNum.toFixed(maxDecimals) : String(Math.round(resultNum));
        const piece = findPieceForMatch(t.line, m.index, m[0]);

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
          piece,
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
        const piece = first.piece;
        const bg = '#ffffff';

        // Precise positioning: if piece available, inherit exact properties
        const font = piece?.font ?? line.font;
        const fontFamily = piece?.fontFamily ?? line.fontFamily;
        const bold = piece?.bold ?? line.bold;
        const italic = piece?.italic ?? line.italic;
        const size = piece?.size ?? line.size;

        const charRatio = line.text.length > 0 ? updatedText.length / line.text.length : 1;
        const width = Math.max(line.width + 0.02, (line.width + 0.02) * Math.max(1, charRatio));

        // Detect if line is aligned right in table
        const align: 'left' | 'center' | 'right' =
          line.x > 0.6 && line.width < 0.25 ? 'right' : 'left';

        const newEdit: PageEdit = {
          id: createId(),
          kind: 'text',
          x: Math.max(0, line.x - 0.002),
          y: line.y,
          width,
          text: updatedText,
          size,
          color: '#000000',
          bold,
          italic,
          font,
          fontFamily,
          align,
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
