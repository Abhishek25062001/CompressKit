import { Download, FilePen, Minimize2, PenLine, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '../../utils/cn';
import { useShallow } from 'zustand/react/shallow';
import { compressPdf, exportImages, parsePageRanges, savePdf, splitPdf } from '../../features/pdf/actions';
import { usePdfSettingsStore, usePdfStore } from '../../store/pdfStore';
import type { PdfPage } from '../../types/pdf';
import { Button } from '../common/Button';
import { NumberField } from '../common/NumberField';
import { SegmentedControl } from '../common/SegmentedControl';
import { Select } from '../common/Select';
import { Switch } from '../common/Switch';
import { TargetSizeField } from '../settings/TargetSizeField';
import { CleanTab, FormsTab, OcrTab, ProtectTab, ScanTab } from './PdfExtraTabs';
import { SignatureMaker } from './SignatureMaker';
import { PDF_TOOLS, type PdfTab } from './pdfTools';
import { StampSettings } from './StampSettings';

type Tab = PdfTab;

/** Eleven tools do not fit a row of tabs: a grid of buttons, one pressed at a time. */
function ToolGrid({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div role="group" aria-label="PDF tool" className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-surface-2 p-1">
      {PDF_TOOLS.map(({ value: tool, label, icon: Icon }) => {
        const active = tool === value;
        return (
          <button
            key={tool}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tool)}
            className={cn(
              'flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition-all',
              active ? 'bg-surface text-fg shadow-sm ring-1 ring-border' : 'text-muted hover:text-fg',
            )}
          >
            <Icon className={cn('h-4 w-4', active && 'text-accent-text')} aria-hidden />
            <span className="max-w-full truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
type Scope = 'all' | 'selected';

function Label({ children }: { children: string }) {
  return <span className="text-xs font-medium tracking-wide text-muted uppercase">{children}</span>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** "All pages" or "Selected (n)", used by every action. */
function ScopePicker({ value, onChange, selected }: { value: Scope; onChange: (v: Scope) => void; selected: number }) {
  return (
    <Row label="Pages">
      <SegmentedControl
        label="Which pages"
        size="sm"
        value={selected ? value : 'all'}
        onChange={onChange}
        segments={[
          { value: 'all', label: 'All' },
          { value: 'selected', label: `Selected (${selected})`, ariaLabel: selected ? undefined : 'Select pages first' },
        ]}
      />
    </Row>
  );
}

/** Selects pages by typing ranges such as "1-3, 7". */
function RangeSelect() {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState(false);
  const apply = () => {
    const { pages, setSelection } = usePdfStore.getState();
    const indexes = parsePageRanges(text, pages.length);
    setError(indexes === null);
    if (indexes) setSelection(new Set(indexes.map((i) => pages[i].id)));
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        Select pages by number
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && apply()}
          placeholder="e.g. 1-3, 7"
          aria-invalid={error}
          aria-describedby={`${id}-hint`}
          className="tabular h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle hover:border-border-strong focus-visible:border-accent aria-[invalid=true]:border-danger"
        />
        <Button onClick={apply}>Select</Button>
      </div>
      <p id={`${id}-hint`} className={error ? 'mt-1.5 text-xs text-danger' : 'mt-1.5 text-xs text-muted'}>
        {error ? 'Use page numbers from the board, like 1-3, 7 or 5-.' : 'Or click pages on the board to select them.'}
      </p>
    </div>
  );
}

/** Where a signature goes when it is applied to pages that have none yet: bottom right, like a form. */
const DEFAULT_PLACEMENT = { id: 'default', x: 0.6, y: 0.8, width: 0.3 };

/** Create or change the signature, put it on many pages at once, and download the signed PDF. */
function SignTab({ target, count, busy }: { target: PdfPage[]; count: string; busy: boolean }) {
  const signature = usePdfStore((s) => s.signature);
  const template = usePdfStore((s) => s.pages.find((p) => p.signatures.length)?.signatures);
  const { applySignatures } = usePdfStore.getState();
  const targetIds = target.map((p) => p.id);
  const signed = usePdfStore(
    useShallow((s) => s.pages.map((p, i) => (p.signatures.length ? `${i + 1}:${p.signatures.length}` : '')).filter(Boolean)),
  );
  const { setSignature } = usePdfStore.getState();
  if (!signature) {
    return (
      <>
        <SignatureMaker />
        <p className="text-xs text-muted">Your signature stays in this browser tab only. It is never uploaded or saved.</p>
      </>
    );
  }
  return (
    <>
      <div className="checkerboard flex h-28 items-center justify-center rounded-xl border border-border p-3">
        <img src={signature.url} alt="Your signature" className="max-h-full max-w-full object-contain" />
      </div>
      <p className="flex gap-2 text-xs text-muted">
        <PenLine className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        Press the pen button under a page to place your signature exactly. Or put it on every page at once: it goes where you placed it
        on a page, or at the bottom right.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => applySignatures(targetIds, template ?? [DEFAULT_PLACEMENT])} disabled={busy || !target.length}>
          Apply to {count}
        </Button>
        <Button variant="ghost" onClick={() => applySignatures(targetIds, [])} disabled={busy || !signed.length}>
          Remove from {count}
        </Button>
      </div>
      {signed.length > 0 && (
        <p className="text-xs text-fg">
          Signed pages:{' '}
          {signed.map((entry) => {
            const [page, n] = entry.split(':');
            return `${page}${n !== '1' ? ` (×${n})` : ''}`;
          }).join(', ')}
        </p>
      )}
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !signed.length}
        onClick={() => void savePdf(target)}
        icon={<Download className="h-4 w-4" aria-hidden />}
      >
        Download signed PDF ({count})
      </Button>
      {!signed.length && <p className="text-xs text-muted">Put your signature on at least one page to download.</p>}
      <Button variant="ghost" onClick={() => setSignature(null)} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
        Use a different signature
      </Button>
      <p className="text-xs text-muted">
        This is a picture of your signature, not a certified digital signature. Page numbers and the watermark from Save are added too.
      </p>
    </>
  );
}

/** Lists the pages with edits, opens the editor, and downloads the edited PDF. */
function EditTab({ target, count, busy }: { target: PdfPage[]; count: string; busy: boolean }) {
  // Plain strings ("id:number"), so the shallow comparison sees an unchanged list as equal.
  const edited = usePdfStore(useShallow((s) => s.pages.flatMap((p, i) => (p.edits?.length ? [`${p.id}:${i + 1}`] : [])))).map((entry) => {
    const [id, n] = entry.split(':');
    return { id, n };
  });
  const first = usePdfStore((s) => (s.pages.find((p) => p.selected) ?? s.pages[0])?.id);
  const firstNumber = usePdfStore((s) => Math.max(1, s.pages.findIndex((p) => p.id === first) + 1));
  const { setEditingPage, pages } = usePdfStore.getState();
  const flattenCovered = usePdfSettingsStore((s) => s.flattenCovered);
  return (
    <>
      <p className="flex gap-2 text-xs text-muted">
        <FilePen className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        Press Edit on a page to change its text, add text boxes and pictures, white out, highlight or draw.
      </p>
      <Button onClick={() => first && setEditingPage(first)} disabled={busy || !first} icon={<FilePen className="h-4 w-4" aria-hidden />}>
        Edit page {firstNumber}
      </Button>
      {edited.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-fg">
            Edited pages:{' '}
            {edited.map((e, i) => (
              <span key={e.id}>
                {i > 0 && ', '}
                <button type="button" className="font-medium text-accent-text underline-offset-2 hover:underline" onClick={() => setEditingPage(e.id)}>
                  {e.n}
                </button>
              </span>
            ))}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => pages.forEach((p) => p.edits?.length && usePdfStore.getState().updatePage(p.id, { edits: [] }))}
            icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
          >
            Undo all edits
          </Button>
        </div>
      )}
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !target.length}
        onClick={() => void savePdf(target)}
        icon={<Download className="h-4 w-4" aria-hidden />}
      >
        Download edited PDF ({count})
      </Button>
      <Switch
        label="Remove covered text for good"
        description={
          flattenCovered
            ? 'Pages with white-out or retyped text are saved as pictures, so nothing underneath can be recovered. Their text is no longer selectable.'
            : 'White-out and retyped text only cover the original: it is still in the file and can be copied or found by search. Turn this on for private details.'
        }
        checked={flattenCovered}
        onChange={(v) => usePdfSettingsStore.getState().update({ flattenCovered: v })}
      />
    </>
  );
}

export function PdfPanel({ initialTab = 'save' }: { initialTab?: PdfTab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [scope, setScope] = useState<Scope>('all');
  const settings = usePdfSettingsStore();
  const { pages, busy, hasPhotos } = usePdfStore(
    useShallow((s) => ({
      pages: s.pages,
      busy: s.busy !== null,
      hasPhotos: s.pages.some((p) => s.sources[p.sourceId]?.kind === 'image'),
    })),
  );
  const selected = pages.filter((p) => p.selected);
  const target: PdfPage[] = scope === 'selected' && selected.length ? selected : pages;
  const count = `${target.length} page${target.length === 1 ? '' : 's'}`;
  const chunks = Math.ceil(target.length / Math.max(1, settings.splitEvery));

  return (
    <section aria-labelledby="pdf-panel-title" className="card p-5">
      <h2 id="pdf-panel-title" className="mb-4 text-sm font-semibold text-fg">
        PDF tools
      </h2>
      <ToolGrid value={tab} onChange={setTab} />
      <div className="my-5 h-px bg-border" />

      <div className="space-y-5">
        <ScopePicker value={scope} onChange={setScope} selected={selected.length} />

        {tab === 'save' && (
          <>
            <p className="text-xs text-muted">
              One PDF with the pages in board order. Use it to turn photos into a PDF, merge PDFs, or save a reordered copy. Pages from
              PDFs are copied as they are, so their text stays sharp and selectable.
            </p>
            {hasPhotos && (
              <div className="space-y-4 rounded-xl border border-border bg-surface-2/40 p-3">
                <p className="text-xs font-medium text-fg">Page setup for photos</p>
                <Select
                  label="Page size"
                  value={settings.pageSize}
                  onChange={(pageSize) => settings.update({ pageSize })}
                  options={[
                    { value: 'a4', label: 'A4 (210 × 297 mm)' },
                    { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
                    { value: 'fit', label: 'Fit to photo' },
                  ]}
                />
                {settings.pageSize !== 'fit' && (
                  <Row label="Orientation">
                    <SegmentedControl
                      label="Orientation"
                      size="sm"
                      value={settings.orientation}
                      onChange={(orientation) => settings.update({ orientation })}
                      segments={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'portrait', label: 'Portrait' },
                        { value: 'landscape', label: 'Landscape' },
                      ]}
                    />
                  </Row>
                )}
                <Row label="Margin">
                  <SegmentedControl
                    label="Margin"
                    size="sm"
                    value={settings.margin}
                    onChange={(margin) => settings.update({ margin })}
                    segments={[
                      { value: 'none', label: 'None' },
                      { value: 'small', label: 'Small' },
                      { value: 'large', label: 'Large' },
                    ]}
                  />
                </Row>
                <Row label="Photo quality">
                  <SegmentedControl
                    label="Photo quality"
                    size="sm"
                    value={settings.photoQuality}
                    onChange={(photoQuality) => settings.update({ photoQuality })}
                    segments={[
                      { value: 'standard', label: 'Standard' },
                      { value: 'original', label: 'Original' },
                    ]}
                  />
                </Row>
                <p className="text-xs text-muted">
                  {settings.photoQuality === 'standard'
                    ? 'Large phone photos are scaled to about 200 DPI on the page: sharp for reading and printing, and much smaller files.'
                    : 'Photos keep their full resolution. Expect several MB per page.'}
                </p>
              </div>
            )}
            <StampSettings />
            <Button
              variant="primary"
              className="w-full"
              disabled={busy || !target.length}
              onClick={() => void savePdf(target)}
              icon={<Download className="h-4 w-4" aria-hidden />}
            >
              Download PDF ({count})
            </Button>
          </>
        )}

        {tab === 'split' && (
          <>
            <RangeSelect />
            <NumberField
              label="Pages per file"
              suffix={settings.splitEvery === 1 ? 'page' : 'pages'}
              value={settings.splitEvery}
              onChange={(n) => settings.update({ splitEvery: n ?? 1 })}
            />
            <p className="text-xs text-muted">
              {chunks === 1
                ? 'All of these pages fit in one file. Lower the number to split them.'
                : `Makes ${chunks} PDFs, downloaded together as a ZIP. To pull out some pages as one PDF, select them and use Save.`}
              {' '}Page numbers, watermark and signatures from the Save and Sign tabs are added too.
            </p>
            <Button
              variant="primary"
              className="w-full"
              disabled={busy || !target.length}
              onClick={() => void splitPdf(target, settings.splitEvery)}
              icon={<Download className="h-4 w-4" aria-hidden />}
            >
              {chunks === 1 ? `Download PDF (${count})` : `Split into ${chunks} PDFs`}
            </Button>
          </>
        )}

        {tab === 'images' && (
          <>
            <Row label="Format">
              <SegmentedControl
                label="Image format"
                size="sm"
                value={settings.imageFormat}
                onChange={(imageFormat) => settings.update({ imageFormat })}
                segments={[
                  { value: 'jpeg', label: 'JPG' },
                  { value: 'png', label: 'PNG' },
                ]}
              />
            </Row>
            <Row label="Resolution">
              <SegmentedControl
                label="Resolution"
                size="sm"
                value={String(settings.imageDpi) as '72' | '150' | '300'}
                onChange={(v) => settings.update({ imageDpi: Number(v) as 72 | 150 | 300 })}
                segments={[
                  { value: '72', label: '72 DPI' },
                  { value: '150', label: '150' },
                  { value: '300', label: '300' },
                ]}
              />
            </Row>
            <p className="text-xs text-muted">
              150 DPI suits screens and uploads; 300 DPI suits printing. Photos keep their own resolution. Several pages download as a ZIP.
            </p>
            <Button
              variant="primary"
              className="w-full"
              disabled={busy || !target.length}
              onClick={() => void exportImages(target)}
              icon={<Download className="h-4 w-4" aria-hidden />}
            >
              Save {count} as {settings.imageFormat === 'png' ? 'PNG' : 'JPG'}
            </Button>
          </>
        )}

        {tab === 'compress' && (
          <>
            <Row label="Strength">
              <SegmentedControl
                label="Compression strength"
                size="sm"
                value={settings.compressLevel}
                onChange={(compressLevel) => settings.update({ compressLevel })}
                segments={[
                  { value: 'light', label: 'Light' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'strong', label: 'Strong' },
                ]}
              />
            </Row>
            <p className="text-xs text-muted">
              Photos and scans inside the PDF are made smaller. Text, fonts and drawings stay as they are, so text remains sharp and
              selectable. A PDF of plain text is usually small already.
            </p>
            <TargetSizeField
              value={settings.compressTargetKB}
              onChange={(compressTargetKB) => settings.update({ compressTargetKB })}
              hint="Starts at the chosen strength and steps up until the file fits."
            />
            {settings.compressTargetKB ? (
              <Switch
                label="Flatten pages if needed"
                description="Last resort: turns each page into a picture. Text will no longer be selectable or searchable."
                checked={settings.allowFlatten}
                onChange={(allowFlatten) => settings.update({ allowFlatten })}
              />
            ) : null}
            <Button
              variant="primary"
              className="w-full"
              disabled={busy || !target.length}
              onClick={() => void compressPdf(target)}
              icon={<Minimize2 className="h-4 w-4" aria-hidden />}
            >
              Compress PDF ({count})
            </Button>
          </>
        )}

        {tab === 'edit' && <EditTab target={target} count={count} busy={busy} />}
        {tab === 'sign' && <SignTab target={target} count={count} busy={busy} />}
        {tab === 'scan' && <ScanTab target={target} count={count} busy={busy} />}
        {tab === 'forms' && <FormsTab target={target} count={count} busy={busy} />}
        {tab === 'protect' && <ProtectTab target={target} count={count} busy={busy} />}
        {tab === 'clean' && <CleanTab target={target} count={count} busy={busy} />}
        {tab === 'ocr' && <OcrTab target={target} count={count} busy={busy} />}
      </div>
    </section>
  );
}
