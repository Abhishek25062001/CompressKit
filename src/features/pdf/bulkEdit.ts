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

export type FontWeightOption = 'auto' | 'normal' | 'bold';

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
  propagateColumn: boolean; // whether to propagate to subsequent column rows (running balance)
  // Generic number mode options
  numberOp: NumberOperation;
  numberDelta: number;
  findAllNumbers?: boolean;
  // Font styling options
  fontWeight: FontWeightOption;
  fontFamily?: string;
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
  isRunningBalanceCol?: boolean;
  direction?: 'credit' | 'debit';
  delta?: number;
  contextTag?: string; // e.g. "Student Fees" or "Running Balance Column"
  customBold?: boolean; // per-match bold toggle
  customFontFamily?: string;
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

interface ScanTarget {
  text: string;
  line: PageTextLine;
  lineIndex: number;
  existingEditId?: string;
  page: PdfPage;
  pageIndex: number;
}

function extractScanTargets(page: PdfPage, pageIndex: number, lines: PageTextLine[]): ScanTarget[] {
  const existingEdits = page.edits ?? [];
  const isLineCovered = (line: PageTextLine) =>
    existingEdits.some(
      (e) =>
        e.kind === 'text' &&
        e.background &&
        Math.abs(e.y - line.y) < Math.max(line.size, 0.015) &&
        e.x <= line.x + 0.05,
    );

  const targets: ScanTarget[] = [];
  lines.forEach((l, idx) => {
    if (!isLineCovered(l)) {
      targets.push({ text: l.text, line: l, lineIndex: idx, page, pageIndex });
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
        page,
        pageIndex,
      });
    }
  });

  return targets;
}

/** Finds all matching occurrences across the scanned PDF targets. */
export async function scanPdfForMatches(
  pages: PdfPage[],
  sources: Record<string, PdfSource>,
  options: BulkSearchOptions,
  onProgress?: (progress: number, pageNum: number) => void,
): Promise<BulkMatchOccurrence[]> {
  const targetPages = options.scope === 'selected'
    ? pages.filter((p) => p.selected)
    : pages;

  const allTargets: ScanTarget[] = [];
  for (let i = 0; i < targetPages.length; i++) {
    const page = targetPages[i];
    const source = sources[page.sourceId];
    onProgress?.((i + 1) / targetPages.length, i + 1);

    const lines = await getOrExtractPageLines(page, source);
    allTargets.push(...extractScanTargets(page, i, lines));
  }

  const allMatches: BulkMatchOccurrence[] = [];
  const matchedTargetKeys = new Set<string>();

  const recordMatch = (m: BulkMatchOccurrence) => {
    const key = `${m.pageId}:${m.lineIndex}:${m.startIndex}`;
    if (matchedTargetKeys.has(key)) return;
    matchedTargetKeys.add(key);
    allMatches.push(m);
  };

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

    for (const t of allTargets) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(t.text)) !== null) {
        if (!m[0]) {
          regex.lastIndex++;
          continue;
        }
        const piece = findPieceForMatch(t.line, m.index, m[0]);
        recordMatch({
          id: `${t.page.id}-${t.lineIndex}-${m.index}`,
          pageId: t.page.id,
          pageIndex: t.pageIndex,
          pageNumber: t.pageIndex + 1,
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

    const parsedQuery = parseFinancialValue(queryStr);
    const targetNum = parsedQuery ? parsedQuery.number : parseFloat(queryStr.replace(/[^\d.]/g, ''));
    if (Number.isNaN(targetNum)) return [];

    const numRegex = /(?:[₹$€£]|Rs\.?|INR)?\s*[-+]?\d[\d,]*(?:\.\d+)?(?:\s*\/-)?/gi;

    const primaryMatches: BulkMatchOccurrence[] = [];
    let computedDelta = 0;

    for (const t of allTargets) {
      if (options.contextFilter && options.contextFilter.trim()) {
        const filterRegex = new RegExp(escapeRegExp(options.contextFilter.trim()), 'i');
        if (!filterRegex.test(t.text)) continue;
      }

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
          const piece = findPieceForMatch(t.line, m.index, token);

          const dir =
            options.transactionDirection === 'auto'
              ? detectTransactionDirection(t.text)
              : options.transactionDirection;

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

          const primaryMatch: BulkMatchOccurrence = {
            id: `${t.page.id}-${t.lineIndex}-${m.index}`,
            pageId: t.page.id,
            pageIndex: t.pageIndex,
            pageNumber: t.pageIndex + 1,
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

          recordMatch(primaryMatch);
          primaryMatches.push(primaryMatch);
          break;
        }
      }
      if (primaryMatches.length > 0 && options.contextFilter) break;
    }

    // Balance and Column Propagation:
    if (
      (options.updateBalances || options.propagateColumn) &&
      primaryMatches.length > 0 &&
      Math.abs(computedDelta) > 0.0001
    ) {
      for (const pm of primaryMatches) {
        const balanceChange = pm.direction === 'debit' ? -computedDelta : computedDelta;

        // 1. Identify the Running Balance Column
        // Check if there is another numeric cell in the same row to the right (Debit/Credit -> Balance)
        const sameRowBalanceTarget = allTargets.find(
          (t) =>
            t.page.id === pm.pageId &&
            t.lineIndex !== pm.lineIndex &&
            Math.abs(t.line.y - pm.line.y) < 0.015 &&
            t.line.x > pm.line.x + pm.line.width + 0.005 &&
            /[-+]?\d[\d,]*(?:\.\d+)?/.test(t.text),
        );

        let colLeft: number;
        let colRight: number;

        if (sameRowBalanceTarget) {
          // Transaction was edited; the balance is in this column
          colLeft = sameRowBalanceTarget.line.x;
          colRight = sameRowBalanceTarget.line.x + sameRowBalanceTarget.line.width;

          // Update the balance cell on the same row
          numRegex.lastIndex = 0;
          const sameRowM = numRegex.exec(sameRowBalanceTarget.text);
          if (sameRowM) {
            const token = sameRowM[0].trim();
            const parsedToken = parseFinancialValue(token);
            if (parsedToken) {
              const updatedBal = parsedToken.number + balanceChange;
              const repl = formatFinancialValue(updatedBal, parsedToken);
              recordMatch({
                id: `${sameRowBalanceTarget.page.id}-${sameRowBalanceTarget.lineIndex}-${sameRowM.index}-dep`,
                pageId: sameRowBalanceTarget.page.id,
                pageIndex: sameRowBalanceTarget.pageIndex,
                pageNumber: sameRowBalanceTarget.pageIndex + 1,
                lineIndex: sameRowBalanceTarget.lineIndex,
                originalLineText: sameRowBalanceTarget.text,
                matchedText: token,
                replacementText: repl,
                startIndex: sameRowM.index,
                endIndex: sameRowM.index + sameRowM[0].length,
                line: sameRowBalanceTarget.line,
                existingEditId: sameRowBalanceTarget.existingEditId,
                selected: true,
                isDependentBalance: true,
                isRunningBalanceCol: true,
                delta: balanceChange,
                contextTag: 'Row Balance',
              });
            }
          }
        } else {
          // The edited match itself is in the balance column (e.g. 25234.06 in statement)
          colLeft = pm.line.x;
          colRight = pm.line.x + pm.line.width;
        }

        // 2. Propagate down the Running Balance Column for subsequent rows (same page & subsequent pages)
        for (const t of allTargets) {
          // On the same page, only consider rows strictly below the matched row
          if (t.pageIndex < pm.pageIndex) continue;
          if (t.pageIndex === pm.pageIndex && t.line.y <= pm.line.y + 0.004) continue;

          const tRight = t.line.x + t.line.width;
          const tLeft = t.line.x;
          // Check right-edge or left-edge horizontal column alignment within 4.5% tolerance
          const alignsRight = Math.abs(tRight - colRight) < 0.045;
          const alignsLeft = Math.abs(tLeft - colLeft) < 0.045;

          if (alignsRight || alignsLeft) {
            numRegex.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = numRegex.exec(t.text)) !== null) {
              const token = m[0].trim();
              const parsedToken = parseFinancialValue(token);
              if (!parsedToken) continue;

              const updatedBal = parsedToken.number + balanceChange;
              const replacementText = formatFinancialValue(updatedBal, parsedToken);
              const piece = findPieceForMatch(t.line, m.index, token);

              recordMatch({
                id: `${t.page.id}-${t.lineIndex}-${m.index}-col`,
                pageId: t.page.id,
                pageIndex: t.pageIndex,
                pageNumber: t.pageIndex + 1,
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
                isRunningBalanceCol: true,
                delta: balanceChange,
                contextTag: 'Running Balance Column',
              });
            }
          }
        }

        // 3. Update any Summary / Closing Balance / Total lines anywhere in document
        for (const t of allTargets) {
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

              recordMatch({
                id: `${t.page.id}-${t.lineIndex}-${m.index}-sum`,
                pageId: t.page.id,
                pageIndex: t.pageIndex,
                pageNumber: t.pageIndex + 1,
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
                contextTag: `Summary: ${t.text.split(/[:\t-]/)[0]?.trim() || 'Balance'}`,
              });
            }
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

    const numberMatches: BulkMatchOccurrence[] = [];

    for (const t of allTargets) {
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

        const matchItem: BulkMatchOccurrence = {
          id: `${t.page.id}-${t.lineIndex}-${m.index}`,
          pageId: t.page.id,
          pageIndex: t.pageIndex,
          pageNumber: t.pageIndex + 1,
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
        };

        recordMatch(matchItem);
        numberMatches.push(matchItem);
      }
    }

    // If propagateColumn is enabled in number mode, propagate delta down column
    if (
      options.propagateColumn &&
      !options.findAllNumbers &&
      numberMatches.length > 0 &&
      options.numberDelta !== 0
    ) {
      for (const nm of numberMatches) {
        const colLeft = nm.line.x;
        const colRight = nm.line.x + nm.line.width;
        const colDelta =
          options.numberOp === 'subtract' ? -options.numberDelta : options.numberDelta;

        const numRegex = /(?<![\w])-?\d+(?:\.\d+)?(?![\w])/g;

        for (const t of allTargets) {
          if (t.pageIndex < nm.pageIndex) continue;
          if (t.pageIndex === nm.pageIndex && t.line.y <= nm.line.y + 0.004) continue;

          const tRight = t.line.x + t.line.width;
          const tLeft = t.line.x;
          const alignsRight = Math.abs(tRight - colRight) < 0.045;
          const alignsLeft = Math.abs(tLeft - colLeft) < 0.045;

          if (alignsRight || alignsLeft) {
            numRegex.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = numRegex.exec(t.text)) !== null) {
              const numVal = parseFloat(m[0]);
              if (Number.isNaN(numVal)) continue;

              const resultNum = numVal + colDelta;
              const matchDecimals = m[0].includes('.') ? (m[0].split('.')[1] || '').length : 0;
              const deltaStr = String(options.numberDelta);
              const deltaDecimals = deltaStr.includes('.') ? (deltaStr.split('.')[1] || '').length : 0;
              const maxDecimals = Math.max(matchDecimals, deltaDecimals);

              const repl = maxDecimals > 0 ? resultNum.toFixed(maxDecimals) : String(Math.round(resultNum));
              const piece = findPieceForMatch(t.line, m.index, m[0]);

              recordMatch({
                id: `${t.page.id}-${t.lineIndex}-${m.index}-col`,
                pageId: t.page.id,
                pageIndex: t.pageIndex,
                pageNumber: t.pageIndex + 1,
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
                isDependentBalance: true,
                isRunningBalanceCol: true,
                delta: colDelta,
                contextTag: 'Running Balance Column',
              });
            }
          }
        }
      }
    }
  }

  return allMatches;
}

/** Finds all matching occurrences on a single page. */
export function findMatchesInPageLines(
  page: PdfPage,
  pageIndex: number,
  lines: PageTextLine[],
  options: BulkSearchOptions,
): BulkMatchOccurrence[] {
  pageLinesCache.set(`${page.id}_${page.rotation}`, lines);
  const targets = extractScanTargets(page, pageIndex, lines);
  const matches: BulkMatchOccurrence[] = [];

  if (options.mode === 'text' && options.query) {
    const escaped = escapeRegExp(options.query);
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
          id: `${t.page.id}-${t.lineIndex}-${m.index}`,
          pageId: t.page.id,
          pageIndex: t.pageIndex,
          pageNumber: t.pageIndex + 1,
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
  }

  return matches;
}

/** Applies bulk replacements across the PDF, recording an undo snapshot. */
export function applyBulkMatches(
  pages: PdfPage[],
  matchesToApply: BulkMatchOccurrence[],
  description: string,
  options?: Partial<BulkSearchOptions>,
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

        // Precise positioning & font resolution
        const font = piece?.font ?? line.font ?? 'sans';
        const fontFamily =
          first.customFontFamily ??
          (options?.fontFamily && options.fontFamily !== 'auto'
            ? options.fontFamily
            : piece?.fontFamily ?? line.fontFamily);

        const isPurelyNumeric = /^[-+₹$€£\s\d,.]+(?:\/-)?$/i.test(updatedText.trim());
        let bold: boolean;
        if (first.customBold !== undefined) {
          bold = first.customBold;
        } else if (options?.fontWeight === 'normal') {
          bold = false;
        } else if (options?.fontWeight === 'bold') {
          bold = true;
        } else if (isPurelyNumeric) {
          // Tabular and financial numbers default to regular (400) weight
          bold = false;
        } else {
          bold = piece?.bold ?? line.bold;
        }

        const italic = piece?.italic ?? line.italic;
        const size = piece?.size ?? line.size;

        const charRatio = line.text.length > 0 ? updatedText.length / line.text.length : 1;
        const width = Math.max(line.width + 0.02, (line.width + 0.02) * Math.max(1, charRatio));

        // Detect if line is aligned right in table
        const align: 'left' | 'center' | 'right' =
          line.x > 0.55 && line.width < 0.35 ? 'right' : 'left';

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
          coverHeight: Math.max(line.height, size * 1.25),
          coverWidth: Math.max(line.width + 0.008, (line.width + 0.008) * Math.max(1, charRatio)),
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
