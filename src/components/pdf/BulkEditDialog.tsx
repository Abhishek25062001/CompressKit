import {
  ArrowRight,
  Calculator,
  Check,
  CheckSquare,
  CornerDownRight,
  Hash,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  TrendingDown,
  TrendingUp,
  Type,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  applyBulkMatches,
  parseFinancialValue,
  scanPdfForMatches,
  type BulkMatchOccurrence,
  type BulkMode,
  type BulkSearchOptions,
  type FontWeightOption,
  type NumberOperation,
  type TransactionDirection,
} from '../../features/pdf/bulkEdit';
import { usePdfStore } from '../../store/pdfStore';
import { cn } from '../../utils/cn';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';

export function BulkEditDialog() {
  const open = usePdfStore((s) => s.bulkEditing);
  const { setBulkEditing, undoLastBulkEdit, lastBulkEdit } = usePdfStore.getState();
  const { pages, sources, hasSelectedPages } = usePdfStore(
    useShallow((s) => ({
      pages: s.pages,
      sources: s.sources,
      hasSelectedPages: s.pages.some((p) => p.selected),
    })),
  );

  const [mode, setMode] = useState<BulkMode>('transaction');

  // Text search state
  const [textQuery, setTextQuery] = useState('');
  const [textReplacement, setTextReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  // Transaction & Financial state
  const [transQuery, setTransQuery] = useState('3100');
  const [contextFilter, setContextFilter] = useState('');
  const [transDirection, setTransDirection] = useState<TransactionDirection>('auto');
  const [newValueStr, setNewValueStr] = useState('3500');
  const [adjustByStr, setAdjustByStr] = useState('+400');
  const [updateBalances, setUpdateBalances] = useState(true);
  const [propagateColumn, setPropagateColumn] = useState(true);

  // Number search state
  const [findNumber, setFindNumber] = useState('100');
  const [findAllNumbers, setFindAllNumbers] = useState(false);
  const [numberOp, setNumberOp] = useState<NumberOperation>('add');
  const [numberDeltaStr, setNumberDeltaStr] = useState('5');

  // Font styling state
  const [fontWeight, setFontWeight] = useState<FontWeightOption>('normal');
  const [fontFamily, setFontFamily] = useState<string>('auto');

  // Scope & results
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [matches, setMatches] = useState<BulkMatchOccurrence[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  const textSearchInputId = useId();
  const textReplaceInputId = useId();
  const transAmountInputId = useId();
  const transContextInputId = useId();
  const newValueInputId = useId();
  const adjustByInputId = useId();
  const numFindInputId = useId();
  const numDeltaInputId = useId();

  const handleClose = useCallback(() => {
    setBulkEditing(false);
  }, [setBulkEditing]);

  const bulkEditInitial = usePdfStore((s) => s.bulkEditInitial);
  useEffect(() => {
    if (!open) return;
    if (bulkEditInitial) {
      if (bulkEditInitial.mode) setMode(bulkEditInitial.mode);
      if (bulkEditInitial.query) {
        setTransQuery(bulkEditInitial.query);
        setTextQuery(bulkEditInitial.query);
        setFindNumber(bulkEditInitial.query);
      }
      if (bulkEditInitial.adjustBy !== undefined) {
        const sign = bulkEditInitial.adjustBy >= 0 ? `+${bulkEditInitial.adjustBy}` : `${bulkEditInitial.adjustBy}`;
        setAdjustByStr(sign);
        if (bulkEditInitial.query) {
          const parsed = parseFinancialValue(bulkEditInitial.query) || { number: parseFloat(bulkEditInitial.query.replace(/[^\d.]/g, '')) };
          if (!Number.isNaN(parsed.number)) {
            setNewValueStr(String(parsed.number + bulkEditInitial.adjustBy));
          }
        }
      }
      if (bulkEditInitial.newAmount !== undefined) {
        setNewValueStr(String(bulkEditInitial.newAmount));
      }
    }
  }, [open, bulkEditInitial]);

  // Synchronize New Value and Adjust By inputs when user types in either
  const handleTransQueryChange = (val: string) => {
    setTransQuery(val);
    const parsedOriginal = parseFinancialValue(val) || { number: parseFloat(val.replace(/[^\d.]/g, '')) };
    const diff = parseFloat(adjustByStr);
    if (!Number.isNaN(parsedOriginal.number) && !Number.isNaN(diff)) {
      const calcNew = parsedOriginal.number + diff;
      setNewValueStr(String(calcNew));
    }
  };

  const handleNewValueChange = (val: string) => {
    setNewValueStr(val);
    const parsedOriginal = parseFinancialValue(transQuery) || { number: parseFloat(transQuery.replace(/[^\d.]/g, '')) };
    const parsedNew = parseFinancialValue(val) || { number: parseFloat(val.replace(/[^\d.]/g, '')) };

    if (!Number.isNaN(parsedOriginal.number) && !Number.isNaN(parsedNew.number)) {
      const diff = parsedNew.number - parsedOriginal.number;
      setAdjustByStr(diff >= 0 ? `+${diff}` : `${diff}`);
    }
  };

  const handleAdjustByChange = (val: string) => {
    setAdjustByStr(val);
    const parsedOriginal = parseFinancialValue(transQuery) || { number: parseFloat(transQuery.replace(/[^\d.]/g, '')) };
    const diff = parseFloat(val);

    if (!Number.isNaN(parsedOriginal.number) && !Number.isNaN(diff)) {
      const calcNew = parsedOriginal.number + diff;
      setNewValueStr(String(calcNew));
    }
  };

  // Perform search / scanning across PDF pages
  const runScan = useCallback(async () => {
    if (mode === 'text' && !textQuery.trim()) {
      setMatches([]);
      setAppliedNotice(null);
      return;
    }

    if (mode === 'transaction' && !transQuery.trim()) {
      setMatches([]);
      setAppliedNotice(null);
      return;
    }

    if (mode === 'number' && !findAllNumbers && !findNumber.trim()) {
      setMatches([]);
      setAppliedNotice(null);
      return;
    }

    setScanning(true);
    setAppliedNotice(null);

    const parsedNewAmount = parseFloat(newValueStr.replace(/[^\d.-]/g, ''));
    const parsedAdjustBy = parseFloat(adjustByStr.replace(/[^\d.-]/g, ''));
    const parsedDelta = parseFloat(numberDeltaStr) || 0;

    const options: BulkSearchOptions = {
      mode,
      query: mode === 'text' ? textQuery.trim() : mode === 'transaction' ? transQuery.trim() : findNumber.trim(),
      replacement: textReplacement,
      contextFilter: mode === 'transaction' ? (contextFilter.trim() || undefined) : undefined,
      transactionDirection: transDirection,
      newAmount: Number.isNaN(parsedNewAmount) ? undefined : parsedNewAmount,
      adjustBy: Number.isNaN(parsedAdjustBy) ? undefined : parsedAdjustBy,
      updateBalances,
      propagateColumn,
      fontWeight,
      fontFamily: fontFamily === 'auto' ? undefined : fontFamily,
      numberOp,
      numberDelta: parsedDelta,
      caseSensitive,
      wholeWord,
      scope: hasSelectedPages ? scope : 'all',
      findAllNumbers: mode === 'number' && findAllNumbers,
    };

    try {
      const results = await scanPdfForMatches(
        pages,
        sources,
        options,
        (_ratio, pageNum) => {
          setScanProgress(`Scanning page ${pageNum}…`);
        },
      );
      setMatches(results);
    } catch (err) {
      console.error('[BulkEdit] Error scanning:', err);
    } finally {
      setScanning(false);
      setScanProgress('');
    }
  }, [
    mode,
    textQuery,
    textReplacement,
    caseSensitive,
    wholeWord,
    transQuery,
    contextFilter,
    transDirection,
    newValueStr,
    adjustByStr,
    updateBalances,
    propagateColumn,
    fontWeight,
    fontFamily,
    findNumber,
    findAllNumbers,
    numberOp,
    numberDeltaStr,
    scope,
    hasSelectedPages,
    pages,
    sources,
  ]);

  // Debounced scan when search options change
  const scanTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);

    scanTimerRef.current = window.setTimeout(() => {
      void runScan();
    }, 250);

    return () => {
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    };
  }, [open, runScan]);

  const toggleSelectAll = () => {
    const allSelected = matches.length > 0 && matches.every((m) => m.selected);
    setMatches((list) => list.map((m) => ({ ...m, selected: !allSelected })));
  };

  const toggleMatch = (id: string) => {
    setMatches((list) =>
      list.map((m) => (m.id === id ? { ...m, selected: !m.selected } : m)),
    );
  };

  const toggleMatchBold = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setMatches((list) =>
      list.map((m) => {
        if (m.id !== id) return m;
        const currentBold =
          m.customBold !== undefined
            ? m.customBold
            : fontWeight === 'bold'
              ? true
              : fontWeight === 'normal'
                ? false
                : (m.piece?.bold ?? m.line.bold);
        return { ...m, customBold: !currentBold };
      }),
    );
  };

  const selectedCount = matches.filter((m) => m.selected).length;

  const handleApply = () => {
    const toApply = matches.filter((m) => m.selected);
    if (!toApply.length) return;

    let desc = '';
    if (mode === 'text') {
      desc = `Replaced "${textQuery}" with "${textReplacement}"`;
    } else if (mode === 'transaction') {
      desc = `Updated transaction to ${newValueStr} and recalculated balances (${adjustByStr})`;
    } else {
      desc = `Adjusted numbers (${numberOp === 'add' ? `+${numberDeltaStr}` : numberOp === 'subtract' ? `-${numberDeltaStr}` : `to ${numberDeltaStr}`})`;
    }

    const count = applyBulkMatches(pages, toApply, desc, {
      fontWeight,
      fontFamily: fontFamily === 'auto' ? undefined : fontFamily,
    });
    const affectedPages = new Set(toApply.map((m) => m.pageNumber)).size;

    setAppliedNotice(
      `Updated ${count} occurrence${count === 1 ? '' : 's'} across ${affectedPages} page${affectedPages === 1 ? '' : 's'}!`,
    );

    void runScan();
  };

  const handleUndo = () => {
    undoLastBulkEdit();
    setAppliedNotice('Bulk edit reverted.');
    void runScan();
  };

  // Group matches by page
  const matchesByPage = matches.reduce<Record<number, BulkMatchOccurrence[]>>((acc, m) => {
    acc[m.pageNumber] = acc[m.pageNumber] || [];
    acc[m.pageNumber].push(m);
    return acc;
  }, {});

  const pageNumbers = Object.keys(matchesByPage)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Intelligent PDF Bulk Editor"
      description="Update transactions with automatic balance recalculation, or bulk replace text and numbers."
      size="wide"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {lastBulkEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUndo}
                icon={<RotateCcw className="h-4 w-4" aria-hidden />}
              >
                Undo last edit ({lastBulkEdit.affectedCount} values)
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={scanning || selectedCount === 0}
              onClick={handleApply}
              icon={
                scanning ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="h-4 w-4" aria-hidden />
                )
              }
            >
              {selectedCount > 0
                ? `Apply to ${selectedCount} selected change${selectedCount === 1 ? '' : 's'}`
                : 'Apply changes'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Mode Selector Tabs */}
        <div className="flex rounded-xl border border-border bg-surface-2/60 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('transaction');
              setAppliedNotice(null);
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:text-sm',
              mode === 'transaction'
                ? 'bg-surface text-fg shadow-sm ring-1 ring-border'
                : 'text-muted hover:text-fg',
            )}
          >
            <Calculator className="h-4 w-4 text-accent-text" aria-hidden />
            <span>Transactions & Balances</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('text');
              setAppliedNotice(null);
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:text-sm',
              mode === 'text'
                ? 'bg-surface text-fg shadow-sm ring-1 ring-border'
                : 'text-muted hover:text-fg',
            )}
          >
            <Type className="h-4 w-4 text-accent-text" aria-hidden />
            <span>Find & Replace Text</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('number');
              setAppliedNotice(null);
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all sm:text-sm',
              mode === 'number'
                ? 'bg-surface text-fg shadow-sm ring-1 ring-border'
                : 'text-muted hover:text-fg',
            )}
          >
            <Hash className="h-4 w-4 text-accent-text" aria-hidden />
            <span>Number Increment</span>
          </button>
        </div>

        {/* 1. TRANSACTION & BALANCE MODE */}
        {mode === 'transaction' && (
          <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Find Amount */}
              <div>
                <label
                  htmlFor={transAmountInputId}
                  className="mb-1 block text-xs font-semibold text-muted uppercase tracking-wide"
                >
                  Transaction Amount to Find
                </label>
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
                  <input
                    id={transAmountInputId}
                    type="text"
                    value={transQuery}
                    onChange={(e) => handleTransQueryChange(e.target.value)}
                    placeholder="e.g. ₹3,100 or 3100"
                    className="h-10 w-full rounded-xl border border-border bg-surface-2/30 pl-9 pr-3 text-sm font-semibold text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {/* Context / Label filter (prevents modifying invoice numbers, dates, account numbers) */}
              <div>
                <label
                  htmlFor={transContextInputId}
                  className="mb-1 block text-xs font-semibold text-muted uppercase tracking-wide"
                >
                  Context Filter (protects unrelated numbers)
                </label>
                <input
                  id={transContextInputId}
                  type="text"
                  value={contextFilter}
                  onChange={(e) => setContextFilter(e.target.value)}
                  placeholder="e.g. Student Fees or Fees (optional)"
                  className="h-10 w-full rounded-xl border border-border bg-surface-2/30 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </div>
            </div>

            {/* Direction: Credit / Income vs Debit / Expense */}
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-surface-2/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs font-medium text-fg">Transaction Type:</span>
              <div className="flex rounded-lg border border-border bg-surface p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTransDirection('auto')}
                  className={cn(
                    'rounded-md px-3 py-1 font-medium transition-colors',
                    transDirection === 'auto'
                      ? 'bg-accent-soft text-accent-text ring-1 ring-accent/30'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  Auto-detect
                </button>
                <button
                  type="button"
                  onClick={() => setTransDirection('credit')}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-3 py-1 font-medium transition-colors',
                    transDirection === 'credit'
                      ? 'bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-400'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  <TrendingUp className="h-3 w-3" />
                  Credit / Income (+)
                </button>
                <button
                  type="button"
                  onClick={() => setTransDirection('debit')}
                  className={cn(
                    'flex items-center gap-1 rounded-md px-3 py-1 font-medium transition-colors',
                    transDirection === 'debit'
                      ? 'bg-rose-500/15 text-rose-600 ring-1 ring-rose-500/30 dark:text-rose-400'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  <TrendingDown className="h-3 w-3" />
                  Debit / Expense (−)
                </button>
              </div>
            </div>

            {/* Synchronized New Value and Adjust By inputs */}
            <div className="grid gap-3 rounded-xl border border-accent/25 bg-accent-soft/10 p-3.5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={newValueInputId}
                  className="mb-1 block text-xs font-semibold text-accent-text uppercase tracking-wide"
                >
                  New Value
                </label>
                <div className="relative flex items-center">
                  <Sparkles className="pointer-events-none absolute left-3 h-4 w-4 text-accent-text" />
                  <input
                    id={newValueInputId}
                    type="text"
                    value={newValueStr}
                    onChange={(e) => handleNewValueChange(e.target.value)}
                    placeholder="e.g. 3500"
                    className="h-10 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm font-semibold text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={adjustByInputId}
                  className="mb-1 block text-xs font-semibold text-accent-text uppercase tracking-wide"
                >
                  Or Adjust By (+/−)
                </label>
                <input
                  id={adjustByInputId}
                  type="text"
                  value={adjustByStr}
                  onChange={(e) => handleAdjustByChange(e.target.value)}
                  placeholder="e.g. +400 or -600"
                  className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </div>

              {/* Quick preset chips */}
              <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2 pt-1">
                <span className="text-[11px] text-muted">Quick adjustments:</span>
                {[
                  { label: '+100', delta: 100 },
                  { label: '+400', delta: 400 },
                  { label: '+500', delta: 500 },
                  { label: '+1,000', delta: 1000 },
                  { label: '-100', delta: -100 },
                  { label: '-600', delta: -600 },
                  { label: '-1,000', delta: -1000 },
                ].map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    onClick={() => handleAdjustByChange(chip.label)}
                    className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-fg"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto balance & Column propagation toggles */}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg">
                  <input
                    type="checkbox"
                    checked={propagateColumn}
                    onChange={(e) => setPropagateColumn(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span>Propagate to subsequent running balances in column</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg">
                  <input
                    type="checkbox"
                    checked={updateBalances}
                    onChange={(e) => setUpdateBalances(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span>Automatically update related Balances, Totals, and Net Amounts</span>
                </label>
              </div>

              {hasSelectedPages && (
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <span>Scope:</span>
                  <button
                    type="button"
                    onClick={() => setScope(scope === 'all' ? 'selected' : 'all')}
                    className="font-medium text-accent-text underline-offset-2 hover:underline"
                  >
                    {scope === 'all' ? 'All pages' : 'Selected pages'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. TEXT REPLACE MODE */}
        {mode === 'text' && (
          <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={textSearchInputId}
                  className="mb-1 block text-xs font-semibold text-muted uppercase tracking-wide"
                >
                  Find text or name
                </label>
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
                  <input
                    id={textSearchInputId}
                    type="text"
                    value={textQuery}
                    onChange={(e) => setTextQuery(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="h-10 w-full rounded-xl border border-border bg-surface-2/30 pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor={textReplaceInputId}
                  className="mb-1 block text-xs font-semibold text-muted uppercase tracking-wide"
                >
                  Replace with
                </label>
                <div className="relative flex items-center">
                  <Sparkles className="pointer-events-none absolute left-3 h-4 w-4 text-accent-text" />
                  <input
                    id={textReplaceInputId}
                    type="text"
                    value={textReplacement}
                    onChange={(e) => setTextReplacement(e.target.value)}
                    placeholder="e.g. Rahul Kumar"
                    className="h-10 w-full rounded-xl border border-border bg-surface-2/30 pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span>Match case (Aa)</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg">
                  <input
                    type="checkbox"
                    checked={wholeWord}
                    onChange={(e) => setWholeWord(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span>Whole words only</span>
                </label>
              </div>

              {hasSelectedPages && (
                <div className="flex items-center gap-2">
                  <span className="text-muted">Scope:</span>
                  <button
                    type="button"
                    onClick={() => setScope('all')}
                    className={cn(
                      'rounded-md px-2 py-1',
                      scope === 'all'
                        ? 'bg-accent-soft font-medium text-accent-text'
                        : 'text-muted hover:text-fg',
                    )}
                  >
                    All pages ({pages.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('selected')}
                    className={cn(
                      'rounded-md px-2 py-1',
                      scope === 'selected'
                        ? 'bg-accent-soft font-medium text-accent-text'
                        : 'text-muted hover:text-fg',
                    )}
                  >
                    Selected only
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 3. NUMBER INCREMENT MODE */}
        {mode === 'number' && (
          <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label
                    htmlFor={numFindInputId}
                    className="block text-xs font-semibold text-muted uppercase tracking-wide"
                  >
                    Find Number
                  </label>
                  <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted hover:text-fg">
                    <input
                      type="checkbox"
                      checked={findAllNumbers}
                      onChange={(e) => setFindAllNumbers(e.target.checked)}
                      className="rounded border-border text-accent focus:ring-accent"
                    />
                    <span>All numbers in PDF</span>
                  </label>
                </div>
                <input
                  id={numFindInputId}
                  type="text"
                  disabled={findAllNumbers}
                  value={findNumber}
                  onChange={(e) => setFindNumber(e.target.value)}
                  placeholder="e.g. 100"
                  className="h-10 w-full rounded-xl border border-border bg-surface-2/30 px-3 text-sm text-fg placeholder:text-muted disabled:opacity-50 focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted uppercase tracking-wide">
                  Operation
                </label>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => setNumberOp('add')}
                    className={cn(
                      'flex h-10 items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-all',
                      numberOp === 'add'
                        ? 'border-accent bg-accent-soft text-accent-text ring-1 ring-accent'
                        : 'border-border bg-surface-2/30 text-muted hover:text-fg',
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Increase By
                  </button>
                  <button
                    type="button"
                    onClick={() => setNumberOp('subtract')}
                    className={cn(
                      'flex h-10 items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-all',
                      numberOp === 'subtract'
                        ? 'border-accent bg-accent-soft text-accent-text ring-1 ring-accent'
                        : 'border-border bg-surface-2/30 text-muted hover:text-fg',
                    )}
                  >
                    <Minus className="h-3.5 w-3.5" />
                    Decrease By
                  </button>
                  <button
                    type="button"
                    onClick={() => setNumberOp('set')}
                    className={cn(
                      'flex h-10 items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-all',
                      numberOp === 'set'
                        ? 'border-accent bg-accent-soft text-accent-text ring-1 ring-accent'
                        : 'border-border bg-surface-2/30 text-muted hover:text-fg',
                    )}
                  >
                    Set Value
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <label
                  htmlFor={numDeltaInputId}
                  className="text-xs font-semibold text-muted whitespace-nowrap uppercase tracking-wide"
                >
                  {numberOp === 'add'
                    ? 'Increase By (+):'
                    : numberOp === 'subtract'
                      ? 'Decrease By (−):'
                      : 'Set Value:'}
                </label>
                <input
                  id={numDeltaInputId}
                  type="text"
                  value={numberDeltaStr}
                  onChange={(e) => setNumberDeltaStr(e.target.value)}
                  className="tabular h-9 w-24 rounded-lg border border-border bg-surface-2/30 px-2 text-center text-sm font-semibold text-fg focus:border-accent focus:outline-none"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted">Presets:</span>
                {[
                  { op: 'add' as const, delta: '5', label: '+5' },
                  { op: 'add' as const, delta: '10', label: '+10' },
                  { op: 'subtract' as const, delta: '2', label: '-2' },
                  { op: 'subtract' as const, delta: '5', label: '-5' },
                  { op: 'subtract' as const, delta: '10', label: '-10' },
                ].map((preset) => (
                  <button
                    key={`${preset.op}-${preset.delta}`}
                    type="button"
                    onClick={() => {
                      setNumberOp(preset.op);
                      setNumberDeltaStr(preset.delta);
                    }}
                    className={cn(
                      'rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-2 hover:text-fg',
                      numberOp === preset.op && numberDeltaStr === preset.delta
                        ? 'bg-accent-soft text-accent-text ring-1 ring-accent/50'
                        : 'text-muted',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {!findAllNumbers && (
              <div className="pt-1">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg">
                  <input
                    type="checkbox"
                    checked={propagateColumn}
                    onChange={(e) => setPropagateColumn(e.target.checked)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span>Propagate to column (running balances)</span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Universal Font Styling Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/40 px-3.5 py-2.5 text-xs">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-accent-text" />
            <span className="font-semibold text-fg">Font Style & Weight:</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Weight Switcher */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted">Weight:</span>
              <div className="flex rounded-lg border border-border bg-surface p-0.5">
                <button
                  type="button"
                  onClick={() => setFontWeight('normal')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    fontWeight === 'normal'
                      ? 'bg-accent-soft text-accent-text ring-1 ring-accent/30 font-normal'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  Normal (400)
                </button>
                <button
                  type="button"
                  onClick={() => setFontWeight('bold')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    fontWeight === 'bold'
                      ? 'bg-accent-soft text-accent-text ring-1 ring-accent/30 font-bold'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  Bold (700)
                </button>
                <button
                  type="button"
                  onClick={() => setFontWeight('auto')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    fontWeight === 'auto'
                      ? 'bg-accent-soft text-accent-text ring-1 ring-accent/30'
                      : 'text-muted hover:text-fg',
                  )}
                >
                  Auto
                </button>
              </div>
            </div>

            {/* Font Family Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted">Font Family:</span>
              <select
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                className="h-7 rounded-lg border border-border bg-surface px-2 text-xs font-medium text-fg focus:border-accent focus:outline-none"
              >
                <option value="auto">Auto (Match Document)</option>
                <option value="Arial">Arial / Sans-Serif</option>
                <option value="Calibri">Calibri</option>
                <option value="Segoe UI">Segoe UI</option>
                <option value="Times New Roman">Times New Roman</option>
                <option value="Courier New">Courier New</option>
              </select>
            </div>
          </div>
        </div>

        {/* Applied Notice Banner */}
        {appliedNotice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" />
              <span className="font-medium">{appliedNotice}</span>
            </div>
            {lastBulkEdit && (
              <button
                type="button"
                onClick={handleUndo}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/30 dark:text-emerald-300"
              >
                <Undo2 className="h-3 w-3" />
                Undo Changes
              </button>
            )}
          </div>
        )}

        {/* Results Header */}
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-fg">
              Matching Changes & Dependent Balances
            </p>
            {scanning ? (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-text" />
                {scanProgress || 'Scanning PDF…'}
              </span>
            ) : (
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">
                {matches.length} found
              </span>
            )}
          </div>

          {matches.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">
                {selectedCount} of {matches.length} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSelectAll}
                icon={
                  selectedCount === matches.length ? (
                    <Square className="h-3.5 w-3.5" />
                  ) : (
                    <CheckSquare className="h-3.5 w-3.5" />
                  )
                }
              >
                {selectedCount === matches.length ? 'Deselect all' : 'Select all'}
              </Button>
            </div>
          )}
        </div>

        {/* Results List */}
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
              {scanning ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-accent-text" />
                  <p className="mt-2 text-sm font-medium text-fg">Scanning PDF pages…</p>
                  <p className="text-xs text-muted">Analyzing document text and financial balances</p>
                </>
              ) : (
                <>
                  <Search className="h-8 w-8 text-muted/50" />
                  <p className="mt-2 text-sm font-medium text-fg">
                    No matching occurrences found
                  </p>
                  <p className="text-xs text-muted">
                    {mode === 'transaction'
                      ? 'Ensure the transaction amount exists in the PDF, or clear the context filter.'
                      : 'Type a search term or number above to scan your PDF.'}
                  </p>
                </>
              )}
            </div>
          ) : (
            pageNumbers.map((pageNum) => {
              const pageMatches = matchesByPage[pageNum];
              return (
                <div key={pageNum} className="rounded-xl border border-border bg-surface-2/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text">
                      Page {pageNum}
                    </span>
                    <span className="text-xs text-muted">
                      {pageMatches.length} value{pageMatches.length === 1 ? '' : 's'} affected
                    </span>
                  </div>

                  <div className="space-y-2">
                    {pageMatches.map((m) => {
                      const beforeContext = m.originalLineText.slice(
                        Math.max(0, m.startIndex - 20),
                        m.startIndex,
                      );
                      const afterContext = m.originalLineText.slice(
                        m.endIndex,
                        Math.min(m.originalLineText.length, m.endIndex + 25),
                      );

                      return (
                        <div
                          key={m.id}
                          onClick={() => toggleMatch(m.id)}
                          className={cn(
                            'group flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition-all',
                            m.isDependentBalance && 'ml-4 border-l-2 border-l-accent bg-accent-soft/10',
                            m.selected
                              ? 'border-accent/40 bg-surface shadow-xs'
                              : 'border-border/50 bg-surface/50 opacity-60 hover:opacity-85',
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={m.selected}
                            onChange={() => toggleMatch(m.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 rounded border-border text-accent focus:ring-accent"
                          />

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                {m.isRunningBalanceCol ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                                    <CornerDownRight className="h-3 w-3" />
                                    Running Balance Row
                                  </span>
                                ) : m.isDependentBalance ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent-text">
                                    <CornerDownRight className="h-3 w-3" />
                                    Dependent Balance
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                                    {m.direction === 'credit'
                                      ? 'Credit / Income'
                                      : m.direction === 'debit'
                                        ? 'Debit / Expense'
                                        : 'Primary Match'}
                                  </span>
                                )}
                                {m.contextTag && (
                                  <span className="text-[11px] text-muted truncate">
                                    {m.contextTag}
                                  </span>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={(e) => toggleMatchBold(m.id, e)}
                                title="Click to toggle Bold or Normal weight for this edit"
                                className={cn(
                                  'rounded border px-2 py-0.5 text-[10px] font-medium transition-colors',
                                  (m.customBold !== undefined ? m.customBold : fontWeight === 'bold' ? true : fontWeight === 'normal' ? false : (m.piece?.bold ?? m.line.bold))
                                    ? 'border-accent/40 bg-accent-soft font-bold text-accent-text'
                                    : 'border-border bg-surface text-muted font-normal hover:text-fg',
                                )}
                              >
                                {(m.customBold !== undefined ? m.customBold : fontWeight === 'bold' ? true : fontWeight === 'normal' ? false : (m.piece?.bold ?? m.line.bold))
                                  ? 'Bold (700)'
                                  : 'Normal (400)'}
                              </button>
                            </div>

                            {/* Before Preview */}
                            <div className="flex items-center gap-2 text-xs text-fg">
                              <span className="text-muted truncate">
                                {m.startIndex > 20 && '…'}
                                {beforeContext}
                              </span>
                              <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 font-semibold text-red-600 line-through dark:text-red-400">
                                {m.matchedText}
                              </span>
                              <span className="text-muted truncate">
                                {afterContext}
                                {m.endIndex + 25 < m.originalLineText.length && '…'}
                              </span>
                            </div>

                            {/* After Replacement Preview */}
                            <div className="flex items-center gap-2 text-xs">
                              <ArrowRight className="h-3 w-3 shrink-0 text-accent-text" />
                              <span
                                className={cn(
                                  'shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400',
                                  (m.customBold !== undefined ? m.customBold : fontWeight === 'bold' ? true : fontWeight === 'normal' ? false : (m.piece?.bold ?? m.line.bold))
                                    ? 'font-bold'
                                    : 'font-normal',
                                )}
                              >
                                {m.replacementText}
                              </span>
                              <span className="text-[11px] text-muted">
                                ({m.customFontFamily || (fontFamily !== 'auto' ? fontFamily : (m.piece?.fontFamily || m.line.fontFamily || 'Arial'))}, {Math.round((m.piece?.size || m.line.size) * 1000) / 10}pt,{' '}
                                {(m.customBold !== undefined ? m.customBold : fontWeight === 'bold' ? true : fontWeight === 'normal' ? false : (m.piece?.bold ?? m.line.bold)) ? 'bold' : 'normal'})
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
