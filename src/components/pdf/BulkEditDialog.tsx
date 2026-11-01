import {
  ArrowRight,
  Check,
  CheckSquare,
  Hash,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Square,
  Type,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  applyBulkMatches,
  scanPdfForMatches,
  type BulkMatchOccurrence,
  type BulkMode,
  type BulkSearchOptions,
  type NumberOperation,
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

  const [mode, setMode] = useState<BulkMode>('text');

  // Text search state
  const [textQuery, setTextQuery] = useState('');
  const [textReplacement, setTextReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  // Number search state
  const [findNumber, setFindNumber] = useState('100');
  const [findAllNumbers, setFindAllNumbers] = useState(false);
  const [numberOp, setNumberOp] = useState<NumberOperation>('add');
  const [numberDelta, setNumberDelta] = useState<number>(5);

  // Scope & results
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [matches, setMatches] = useState<BulkMatchOccurrence[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  const searchInputId = useId();
  const replaceInputId = useId();
  const numInputId = useId();
  const deltaInputId = useId();

  const handleClose = () => {
    setBulkEditing(false);
  };

  // Perform search / scanning across PDF pages
  const runScan = useCallback(async () => {
    const isText = mode === 'text';
    const effectiveQuery = isText ? textQuery.trim() : findNumber.trim();

    if (isText && !effectiveQuery) {
      setMatches([]);
      setAppliedNotice(null);
      return;
    }

    if (!isText && !findAllNumbers && !effectiveQuery) {
      setMatches([]);
      setAppliedNotice(null);
      return;
    }

    setScanning(true);
    setAppliedNotice(null);

    const options: BulkSearchOptions = {
      mode,
      query: effectiveQuery,
      replacement: textReplacement,
      numberOp,
      numberDelta,
      caseSensitive,
      wholeWord,
      scope: hasSelectedPages ? scope : 'all',
      findAllNumbers: !isText && findAllNumbers,
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
    findNumber,
    findAllNumbers,
    numberOp,
    numberDelta,
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

  const selectedCount = matches.filter((m) => m.selected).length;

  const handleApply = () => {
    const toApply = matches.filter((m) => m.selected);
    if (!toApply.length) return;

    const desc =
      mode === 'text'
        ? `Replaced "${textQuery}" with "${textReplacement}"`
        : `Adjusted numbers (${numberOp === 'add' ? `+${numberDelta}` : numberOp === 'subtract' ? `-${numberDelta}` : `to ${numberDelta}`})`;

    const count = applyBulkMatches(pages, toApply, desc);
    const affectedPages = new Set(toApply.map((m) => m.pageNumber)).size;

    setAppliedNotice(
      `Updated ${count} occurrence${count === 1 ? '' : 's'} across ${affectedPages} page${affectedPages === 1 ? '' : 's'}!`,
    );

    // Re-scan to update the view
    void runScan();
  };

  const handleUndo = () => {
    undoLastBulkEdit();
    setAppliedNotice('Bulk edit reverted.');
    void runScan();
  };

  // Group matches by page for clear layout
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
      title="Bulk Edit PDF"
      description="Find and edit repeated names, text or numerical values across all pages in one click."
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
                Undo last bulk change
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
                ? `Apply to ${selectedCount} selected match${selectedCount === 1 ? '' : 'es'}`
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
              setMode('text');
              setAppliedNotice(null);
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all sm:text-sm',
              mode === 'text'
                ? 'bg-surface text-fg shadow-sm ring-1 ring-border'
                : 'text-muted hover:text-fg',
            )}
          >
            <Type className="h-4 w-4 text-accent-text" aria-hidden />
            Find & Edit Text
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('number');
              setAppliedNotice(null);
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all sm:text-sm',
              mode === 'number'
                ? 'bg-surface text-fg shadow-sm ring-1 ring-border'
                : 'text-muted hover:text-fg',
            )}
          >
            <Hash className="h-4 w-4 text-accent-text" aria-hidden />
            Bulk Number Editing / Increment
          </button>
        </div>

        {/* Inputs panel according to Mode */}
        {mode === 'text' ? (
          <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor={searchInputId}
                  className="mb-1 block text-xs font-medium text-muted uppercase"
                >
                  Find text or name
                </label>
                <div className="relative flex items-center">
                  <Search
                    className="pointer-events-none absolute left-3 h-4 w-4 text-muted"
                    aria-hidden
                  />
                  <input
                    id={searchInputId}
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
                  htmlFor={replaceInputId}
                  className="mb-1 block text-xs font-medium text-muted uppercase"
                >
                  Replace with
                </label>
                <div className="relative flex items-center">
                  <Sparkles
                    className="pointer-events-none absolute left-3 h-4 w-4 text-accent-text"
                    aria-hidden
                  />
                  <input
                    id={replaceInputId}
                    type="text"
                    value={textReplacement}
                    onChange={(e) => setTextReplacement(e.target.value)}
                    placeholder="e.g. Rahul Kumar"
                    className="h-10 w-full rounded-xl border border-border bg-surface-2/30 pl-9 pr-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Search toggles & scope */}
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
        ) : (
          <div className="space-y-4 rounded-xl border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label
                    htmlFor={numInputId}
                    className="block text-xs font-medium text-muted uppercase"
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
                  id={numInputId}
                  type="text"
                  disabled={findAllNumbers}
                  value={findNumber}
                  onChange={(e) => setFindNumber(e.target.value)}
                  placeholder="e.g. 100"
                  className="h-10 w-full rounded-xl border border-border bg-surface-2/30 px-3 text-sm text-fg placeholder:text-muted disabled:opacity-50 focus:border-accent focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted uppercase">
                  Operation
                </label>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => setNumberOp('add')}
                    className={cn(
                      'flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-all',
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
                      'flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-all',
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
                      'flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-all',
                      numberOp === 'set'
                        ? 'border-accent bg-accent-soft text-accent-text ring-1 ring-accent'
                        : 'border-border bg-surface-2/30 text-muted hover:text-fg',
                    )}
                  >
                    Replace With
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <label
                  htmlFor={deltaInputId}
                  className="text-xs font-medium text-muted whitespace-nowrap uppercase"
                >
                  {numberOp === 'add'
                    ? 'Add (+):'
                    : numberOp === 'subtract'
                      ? 'Subtract (-):'
                      : 'New Value:'}
                </label>
                <input
                  id={deltaInputId}
                  type="number"
                  step="any"
                  value={numberDelta}
                  onChange={(e) => setNumberDelta(parseFloat(e.target.value) || 0)}
                  className="tabular h-9 w-24 rounded-lg border border-border bg-surface-2/30 px-2 text-center text-sm font-semibold text-fg focus:border-accent focus:outline-none"
                />
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted">Quick presets:</span>
                {[
                  { op: 'add' as const, delta: 5, label: '+5' },
                  { op: 'add' as const, delta: 10, label: '+10' },
                  { op: 'subtract' as const, delta: 2, label: '-2' },
                  { op: 'subtract' as const, delta: 5, label: '-5' },
                  { op: 'subtract' as const, delta: 10, label: '-10' },
                ].map((preset) => (
                  <button
                    key={`${preset.op}-${preset.delta}`}
                    type="button"
                    onClick={() => {
                      setNumberOp(preset.op);
                      setNumberDelta(preset.delta);
                    }}
                    className={cn(
                      'rounded-md border border-border px-2 py-1 text-xs font-medium transition-colors hover:bg-surface-2 hover:text-fg',
                      numberOp === preset.op && numberDelta === preset.delta
                        ? 'bg-accent-soft text-accent-text ring-1 ring-accent/50'
                        : 'text-muted',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Success / Status Banner */}
        {appliedNotice && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" />
              <span>{appliedNotice}</span>
            </div>
            {lastBulkEdit && (
              <button
                type="button"
                onClick={handleUndo}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/30 dark:text-emerald-300"
              >
                <Undo2 className="h-3 w-3" />
                Undo
              </button>
            )}
          </div>
        )}

        {/* Results Header */}
        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-fg">
              Matching Occurrences
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

        {/* Results Content List */}
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {matches.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
              {scanning ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-accent-text" />
                  <p className="mt-2 text-sm font-medium text-fg">Scanning PDF pages…</p>
                  <p className="text-xs text-muted">Checking text and numbers across your document</p>
                </>
              ) : (
                <>
                  <Search className="h-8 w-8 text-muted/50" />
                  <p className="mt-2 text-sm font-medium text-fg">
                    {(mode === 'text' && !textQuery.trim()) ||
                    (mode === 'number' && !findAllNumbers && !findNumber.trim())
                      ? 'Type search term or number above to scan'
                      : 'No matching occurrences found'}
                  </p>
                  <p className="text-xs text-muted">
                    {(mode === 'text' && !textQuery.trim()) ||
                    (mode === 'number' && !findAllNumbers && !findNumber.trim())
                      ? 'The system will search through all pages of the PDF automatically.'
                      : 'Try adjusting your search query, case sensitivity, or check spelling.'}
                  </p>
                </>
              )}
            </div>
          ) : (
            pageNumbers.map((pageNum) => {
              const pageMatches = matchesByPage[pageNum];
              return (
                <div key={pageNum} className="rounded-xl border border-border bg-surface-2/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-text">
                      Page {pageNum}
                    </span>
                    <span className="text-xs text-muted">
                      {pageMatches.length} match{pageMatches.length === 1 ? '' : 'es'}
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
                            {/* Before Preview */}
                            <div className="flex items-center gap-2 text-xs text-fg">
                              <span className="text-muted truncate">
                                {m.startIndex > 20 && '…'}
                                {beforeContext}
                              </span>
                              <span className="shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 font-medium text-red-600 line-through dark:text-red-400">
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
                              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                                {m.replacementText}
                              </span>
                              <span className="text-[11px] text-muted">
                                (Preserves original {m.line.font} font, {Math.round(m.line.size * 1000) / 10}pt size
                                {m.line.bold ? ', bold' : ''})
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
