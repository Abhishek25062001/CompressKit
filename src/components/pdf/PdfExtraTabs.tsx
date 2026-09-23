import { Download, EyeOff, Lock, RotateCcw, ScanSearch, ScanText } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { decodeImage } from '../../features/image/decode';
import { ocrPdf, savePdf } from '../../features/pdf/actions';
import { readForm, type FieldValue, type FormInfo } from '../../features/pdf/forms';
import { inspectSource, type Finding } from '../../features/pdf/inspect';
import { refreshThumbnail } from '../../features/pdf/intake';
import { SCAN_FILTERS, detectPageCorners } from '../../features/pdf/scan';
import { usePdfSettingsStore, usePdfStore } from '../../store/pdfStore';
import { useUiStore } from '../../store/uiStore';
import type { PdfPage, ScanFilter } from '../../types/pdf';
import { Button } from '../common/Button';
import { SegmentedControl } from '../common/SegmentedControl';
import { Switch } from '../common/Switch';

interface TabProps {
  target: PdfPage[];
  count: string;
  busy: boolean;
}

const inputClass =
  'h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle hover:border-border-strong focus-visible:border-accent';

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}

function TextInput({ label, value, onChange, type = 'text', placeholder, invalid, multiline }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  invalid?: boolean;
  multiline?: boolean;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} value={value} rows={3} onChange={(e) => onChange(e.target.value)} className={`${inputClass} h-auto py-2`} />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} aria-[invalid=true]:border-danger`}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Scan */

/** Scan cleanup for many photos at once; the Scan button on a photo fine-tunes one. */
export function ScanTab({ target, busy }: TabProps) {
  const sources = usePdfStore((s) => s.sources);
  const photos = target.filter((p) => sources[p.sourceId]?.kind === 'image');
  const [working, setWorking] = useState(false);
  const common = photos.length && photos.every((p) => (p.scan?.filter ?? 'none') === (photos[0].scan?.filter ?? 'none'));
  const look: ScanFilter = common ? (photos[0].scan?.filter ?? 'none') : 'none';

  const update = (page: PdfPage, patch: Partial<NonNullable<PdfPage['scan']>>) => {
    const next = { corners: page.scan?.corners ?? null, filter: page.scan?.filter ?? 'none', ...patch };
    usePdfStore.getState().updatePage(page.id, { scan: next.corners || next.filter !== 'none' ? next : undefined });
    refreshThumbnail(page.id);
  };

  const findEdges = async () => {
    setWorking(true);
    let found = 0;
    try {
      for (const page of photos) {
        const bitmap = await decodeImage(sources[page.sourceId].file);
        const corners = detectPageCorners(bitmap);
        bitmap.close();
        if (corners) {
          found++;
          update(page, { corners });
        }
      }
    } finally {
      setWorking(false);
    }
    useUiStore.getState().pushNotice({
      tone: found ? 'info' : 'warning',
      title: found ? 'Page edges found' : 'No page edges found',
      message: found
        ? `${found} of ${photos.length} photo${photos.length === 1 ? '' : 's'} straightened. Use Scan on a photo to check or adjust its corners.`
        : 'The photos may already be just the page. Use Scan on a photo to place the corners yourself.',
    });
  };

  if (!photos.length) {
    return <Note>Scan cleanup is for photos of documents. Add photos taken with your phone to straighten and clean them up.</Note>;
  }
  return (
    <>
      <Note>
        Makes phone photos of documents look scanned: straightened to the page edges, with even, clean paper. Applies to the{' '}
        {photos.length} photo page{photos.length === 1 ? '' : 's'} in your selection. Press Scan on a photo to fine-tune it.
      </Note>
      <Button className="w-full" onClick={() => void findEdges()} disabled={busy || working} icon={<ScanSearch className="h-4 w-4" aria-hidden />}>
        {working ? 'Finding page edges…' : 'Straighten all to page edges'}
      </Button>
      <div className="space-y-2">
        <span className="text-xs font-medium tracking-wide text-muted uppercase">Look for all photos</span>
        <SegmentedControl label="Look" size="sm" value={look} onChange={(filter) => photos.forEach((p) => update(p, { filter }))} segments={SCAN_FILTERS} />
        <Note>Black & white is the cleanest for text and the smallest file. Enhanced keeps color, with whiter paper.</Note>
      </div>
      <Button
        variant="ghost"
        onClick={() => photos.forEach((p) => p.scan && (usePdfStore.getState().updatePage(p.id, { scan: undefined }), refreshThumbnail(p.id)))}
        disabled={busy || !photos.some((p) => p.scan)}
        icon={<RotateCcw className="h-4 w-4" aria-hidden />}
      >
        Undo scan cleanup on all
      </Button>
    </>
  );
}

/* ----------------------------------------------------------------- Forms */

function FieldInput({ sourceId, field, value }: { sourceId: string; field: FormInfo['fields'][number]; value: FieldValue }) {
  const set = (v: FieldValue) => usePdfStore.getState().setFormValue(sourceId, field.name, v);
  const id = useId();
  if (field.kind === 'checkbox') {
    return <Switch label={field.label} checked={value === true} onChange={set} />;
  }
  if (field.kind === 'text') {
    return <TextInput label={field.label} value={String(value)} onChange={set} multiline={field.multiline} />;
  }
  if (field.kind === 'list' && field.multiSelect) {
    const chosen = Array.isArray(value) ? value : [];
    return (
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">{field.label}</legend>
        <div className="space-y-1">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                checked={chosen.includes(option)}
                onChange={(e) => set(e.target.checked ? [...chosen, option] : chosen.filter((o) => o !== option))}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  // Radio groups, dropdowns and single-choice lists all pick one option.
  const current = Array.isArray(value) ? (value[0] ?? '') : String(value);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium tracking-wide text-muted uppercase">
        {field.label}
      </label>
      <select
        id={id}
        value={current}
        onChange={(e) => set(field.kind === 'list' ? [e.target.value] : e.target.value)}
        className={`${inputClass} appearance-auto`}
      >
        <option value="">—</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function SourceForm({ sourceId, name }: { sourceId: string; name: string }) {
  const [info, setInfo] = useState<FormInfo | null>(null);
  const answers = usePdfStore((s) => s.formValues[sourceId]);
  useEffect(() => {
    let cancelled = false;
    void readForm(sourceId).then((result) => !cancelled && setInfo(result));
    return () => {
      cancelled = true;
    };
  }, [sourceId]);
  if (!info) return <Note>Reading {name}…</Note>;
  const fields = info.fields.filter((f) => !f.readOnly);
  if (!fields.length) {
    return info.xfa ? (
      <Note>{name} uses an XFA form (made in Adobe LiveCycle), which only Adobe Reader can fill.</Note>
    ) : null;
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-fg" title={name}>
          {name} · {fields.length} field{fields.length === 1 ? '' : 's'}
        </p>
        {answers && (
          <button type="button" className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => usePdfStore.getState().clearFormValues(sourceId)}>
            Reset
          </button>
        )}
      </div>
      {fields.map((field) => (
        <FieldInput key={field.name} sourceId={sourceId} field={field} value={answers?.[field.name] ?? field.value} />
      ))}
    </div>
  );
}

export function FormsTab({ target, count, busy }: TabProps) {
  const pdfSources = usePdfStore(
    useShallow((s) => [...new Set(target.map((p) => p.sourceId))].filter((id) => s.sources[id]?.kind === 'pdf').map((id) => `${id}\u0000${s.sources[id].name}`)),
  );
  const [found, setFound] = useState<boolean | null>(null);
  const filled = usePdfStore((s) => Object.values(s.formValues).some((v) => Object.keys(v).length));

  useEffect(() => {
    let cancelled = false;
    void Promise.all(pdfSources.map((entry) => readForm(entry.split('\u0000')[0])))
      .then((infos) => !cancelled && setFound(infos.some((i) => i.fields.some((f) => !f.readOnly))))
      .catch(() => !cancelled && setFound(false));
    return () => {
      cancelled = true;
    };
  }, [pdfSources]);

  if (!pdfSources.length) return <Note>Add a PDF that has fill-in boxes, such as an application or tax form.</Note>;
  return (
    <>
      {found === false && <Note>None of these PDFs has fill-in boxes. Only PDFs made as forms can be filled here.</Note>}
      {pdfSources.map((entry) => {
        const [id, name] = entry.split('\u0000');
        return <SourceForm key={id} sourceId={id} name={name} />;
      })}
      {found && (
        <>
          <Note>
            Your answers are written onto the page when you download, so they look the same in every viewer and can no longer be changed
            there. Latin letters, numbers and common symbols only.
          </Note>
          <Button
            variant="primary"
            className="w-full"
            disabled={busy || !filled}
            onClick={() => void savePdf(target)}
            icon={<Download className="h-4 w-4" aria-hidden />}
          >
            Download filled PDF ({count})
          </Button>
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------- Protect */

export function ProtectTab({ target, count, busy }: TabProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length > 0 && confirm === password;

  return (
    <>
      <Note>Anyone who opens the PDF will need this password. It is used only in this browser and is not stored anywhere.</Note>
      <TextInput label="Password" type="password" value={password} onChange={setPassword} />
      <TextInput label="Type it again" type="password" value={confirm} onChange={setConfirm} invalid={mismatch} />
      {mismatch && <p className="text-xs text-danger">The passwords do not match.</p>}
      {password.length > 0 && password.length < 6 && <Note>Short passwords are easy to guess. Six characters or more is safer.</Note>}
      <Switch label="Allow printing" checked={allowPrinting} onChange={setAllowPrinting} />
      <Switch label="Allow copying text" checked={allowCopying} onChange={setAllowCopying} />
      <Note>
        Encrypted with AES-256. Keep the password somewhere safe: without it, the file cannot be opened. Printing and copying limits are
        respected by standard PDF readers.
      </Note>
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !ready || !target.length}
        onClick={() => void savePdf(target, { password, allowPrinting, allowCopying })}
        icon={<Lock className="h-4 w-4" aria-hidden />}
      >
        Download protected PDF ({count})
      </Button>
      <Note>To remove a password, add the locked PDF here and enter its password: files you save from it have none.</Note>
    </>
  );
}

/* ----------------------------------------------------------------- Clean */

function SourceFindings({ sourceId }: { sourceId: string }) {
  const source = usePdfStore((s) => s.sources[sourceId]);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (source) void inspectSource(source).then((f) => !cancelled && setFindings(f)).catch(() => !cancelled && setFindings([]));
    return () => {
      cancelled = true;
    };
  }, [source]);
  if (!source) return null;
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-3">
      <p className="truncate text-xs font-medium text-fg" title={source.name}>
        {source.name}
      </p>
      {findings === null ? (
        <Note>Checking…</Note>
      ) : findings.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          {source.kind === 'image' ? 'No camera or location details found.' : 'No hidden details found.'}
        </p>
      ) : (
        <dl className="mt-1.5 space-y-1 text-xs">
          {findings.map((f) => (
            <div key={f.label} className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted">{f.label}</dt>
              <dd className="min-w-0 flex-1 break-words text-fg">
                {f.value}{' '}
                <span className={f.fate === 'removed' ? 'text-accent-text' : 'text-warning'}>
                  {f.fate === 'removed' ? '· removed' : '· see option below'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function CleanTab({ target, count, busy }: TabProps) {
  const sourceIds = usePdfStore(useShallow(() => [...new Set(target.map((p) => p.sourceId))]));
  const removeComments = usePdfSettingsStore((s) => s.removeComments);
  const update = usePdfSettingsStore((s) => s.update);
  const docInfo = usePdfStore((s) => s.docInfo);
  const setDocInfo = usePdfStore((s) => s.setDocInfo);

  return (
    <>
      <Note>
        Files can carry details you cannot see: who made them, when, with what, and where a photo was taken. Here is what your files
        contain. Every PDF you save here is a new file without them.
      </Note>
      <div className="space-y-2">
        {sourceIds.map((id) => (
          <SourceFindings key={id} sourceId={id} />
        ))}
      </div>
      <Switch
        label="Remove comments and markup"
        description="Sticky notes, highlights and drawings. Links and form fields stay."
        checked={removeComments}
        onChange={(v) => update({ removeComments: v })}
      />
      <div className="space-y-3 rounded-xl border border-border bg-surface-2/40 p-3">
        <p className="text-xs font-medium text-fg">Details to include (optional)</p>
        <TextInput label="Title" value={docInfo.title} onChange={(title) => setDocInfo({ title })} placeholder="Left out when empty" />
        <TextInput label="Author" value={docInfo.author} onChange={(author) => setDocInfo({ author })} placeholder="Left out when empty" />
      </div>
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !target.length}
        onClick={() => void savePdf(target)}
        icon={<EyeOff className="h-4 w-4" aria-hidden />}
      >
        Download clean PDF ({count})
      </Button>
      <Note>These settings apply to every PDF you save here, including split and compressed files.</Note>
    </>
  );
}

/* ------------------------------------------------------------------- OCR */

export function OcrTab({ target, count, busy }: TabProps) {
  const [alsoText, setAlsoText] = useState(true);
  return (
    <>
      <Note>
        Reads the text in scans and photos, then saves a PDF where that text can be searched, selected and copied. The page looks
        exactly the same: the text sits invisibly behind it.
      </Note>
      <Note>
        English only for now. Pages that already have text are left as they are. The first time, the text reader (about 7 MB) is
        downloaded from this site, once. Then it takes a few seconds per page, all on your device.
      </Note>
      <Switch label="Also download the text" description="As a .txt file you can paste anywhere." checked={alsoText} onChange={setAlsoText} />
      <Note>For the best results, straighten photos under Scan first, and use the Black & white look.</Note>
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !target.length}
        onClick={() => void ocrPdf(target, { alsoText })}
        icon={<ScanText className="h-4 w-4" aria-hidden />}
      >
        Make searchable PDF ({count})
      </Button>
    </>
  );
}
