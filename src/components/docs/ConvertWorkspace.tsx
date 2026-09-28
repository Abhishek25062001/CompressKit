import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Download, FileCode, FileText, FileType, FileType2, Loader2, PenSquare, Pilcrow, Printer, RotateCcw, Trash2, X, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { acceptAttribute, type FormatDef } from '../../constants/formats';
import { TOOL_BY_ID } from '../../features/catalog';
import { addToConverter, downloadAllJobs, openInEditor, retryJob } from '../../features/docs/actions';
import { HTML_FORMAT, MARKDOWN_FORMAT, RTF_FORMAT, TEXT_FORMAT } from '../../features/docs/formats';
import { DOCX_FORMAT, PDF_FORMAT } from '../../features/pdf/intake';
import {
  DOC_QUEUES,
  useHtmlToPdfSettings,
  usePdfToDocxSettings,
  useTextToPdfSettings,
  type ConvertKind,
  type DocJob,
  type DocPageSize,
} from '../../store/docsStore';
import { useRouteStore } from '../../store/routeStore';
import { downloadBlob } from '../../utils/download';
import { formatBytes } from '../../utils/format';
import { Button } from '../common/Button';
import { ProgressBar } from '../common/ProgressBar';
import { SegmentedControl } from '../common/SegmentedControl';
import { Switch } from '../common/Switch';
import { PasswordDialog } from '../pdf/PasswordDialog';
import { FileDropZone } from '../upload/DropZone';

interface KindUi {
  formats: FormatDef[];
  badges: string[];
  title: string;
  /** Name of the output format on download buttons. */
  to: string;
  icon: LucideIcon;
  /** Opens the original (source) or the converted file (result) in the Word editor. */
  edit?: 'source' | 'result';
}

const UI: Record<ConvertKind, KindUi> = {
  'docx-to-pdf': { formats: [DOCX_FORMAT], badges: ['DOCX'], title: 'Drop Word documents here', to: 'PDF', icon: FileType2, edit: 'source' },
  'pdf-to-docx': { formats: [PDF_FORMAT], badges: ['PDF'], title: 'Drop PDFs here', to: 'Word', icon: FileText, edit: 'result' },
  'text-to-pdf': { formats: [TEXT_FORMAT, MARKDOWN_FORMAT], badges: ['TXT', 'MD'], title: 'Drop text or Markdown files here', to: 'PDF', icon: FileType },
  'rtf-to-pdf': { formats: [RTF_FORMAT], badges: ['RTF'], title: 'Drop RTF documents here', to: 'PDF', icon: Pilcrow },
  'html-to-pdf': { formats: [HTML_FORMAT], badges: ['HTML', 'HTM'], title: 'Drop HTML files here', to: 'PDF', icon: FileCode },
};

/** Opens an HTML file in the browser's print dialog, where "Save as PDF" keeps its exact layout. */
async function printExact(file: File): Promise<void> {
  const { decodeHtml, printHtml } = await import('../../features/docs/htmlRead');
  await printHtml(decodeHtml(new Uint8Array(await file.arrayBuffer())));
}

function JobCard({ kind, job }: { kind: ConvertKind; job: DocJob }) {
  const store = DOC_QUEUES[kind];
  const ui = UI[kind];
  const navigate = useRouteStore((s) => s.navigate);
  const edit = () => {
    const file = ui.edit === 'source' ? job.file : job.result && new File([job.result.blob], job.result.name, { type: job.result.blob.type });
    if (!file) return;
    void openInEditor(file);
    navigate('/edit-docx');
  };
  const Icon = ui.icon;
  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg" title={job.file.name}>
            {job.file.name}
          </p>
          <p className="text-xs text-muted" aria-live="polite">
            {formatBytes(job.file.size)}
            {job.status === 'waiting' && ' · Waiting'}
            {job.status === 'working' && ` · ${job.stage ?? 'Converting'}…`}
            {job.status === 'done' && job.result && (
              <>
                {' → '}
                <span className="font-medium text-fg">{job.result.name}</span> · {formatBytes(job.result.blob.size)}
                {job.result.pages ? ` · ${job.result.pages} page${job.result.pages === 1 ? '' : 's'}` : ''}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Remove ${job.file.name}`}
          onClick={() => store.getState().remove(job.id)}
          disabled={job.status === 'working'}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-30"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {job.status === 'working' && <ProgressBar className="mt-3" value={job.progress} label={`Converting ${job.file.name}`} />}
      {job.status === 'failed' && (
        <p className="mt-3 flex gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {job.error}
        </p>
      )}
      {job.status === 'done' && job.notes?.length ? (
        <ul className="mt-3 space-y-1 text-xs text-muted">
          {job.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      ) : null}
      {(job.status === 'done' || job.status === 'failed') && (
        <div className="mt-3 flex flex-wrap gap-2">
          {job.result && (
            <Button variant="primary" size="sm" onClick={() => downloadBlob(job.result!.blob, job.result!.name)} icon={<Download className="h-3.5 w-3.5" aria-hidden />}>
              Download {ui.to}
            </Button>
          )}
          {ui.edit && job.status === 'done' && (ui.edit === 'source' || job.result) && (
            <Button size="sm" onClick={edit} icon={<PenSquare className="h-3.5 w-3.5" aria-hidden />}>
              {ui.edit === 'source' ? 'Edit document' : 'Edit in browser'}
            </Button>
          )}
          {kind === 'html-to-pdf' && (
            <Button size="sm" onClick={() => void printExact(job.file)} icon={<Printer className="h-3.5 w-3.5" aria-hidden />}>
              Exact layout (print)
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => retryJob(kind, job.id)} icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}>
            {job.status === 'failed' ? 'Try again' : 'Convert again'}
          </Button>
        </div>
      )}
    </li>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

function PageSizeRow({ value, onChange }: { value: DocPageSize; onChange: (v: DocPageSize) => void }) {
  return (
    <Row label="Page size">
      <SegmentedControl
        label="Page size"
        size="sm"
        value={value}
        onChange={onChange}
        segments={[
          { value: 'a4', label: 'A4' },
          { value: 'letter', label: 'Letter' },
        ]}
      />
    </Row>
  );
}

/** Options that apply to every file on the list; changing them offers to convert everything again. */
function Options({ kind, reconvert }: { kind: ConvertKind; reconvert: ReactNode }) {
  const pdfToDocx = usePdfToDocxSettings();
  const text = useTextToPdfSettings();
  const html = useHtmlToPdfSettings();
  switch (kind) {
    case 'pdf-to-docx':
      return (
        <>
          <Switch
            label="Include pictures"
            description="Photos and logos in the PDF are placed in the document where they appear."
            checked={pdfToDocx.images}
            onChange={(images) => pdfToDocx.update({ images })}
          />
          <Switch
            label="Read scanned pages (OCR)"
            description="Pages that are photos or scans are read into editable text (English). Off keeps them as pictures."
            checked={pdfToDocx.ocr}
            onChange={(ocr) => pdfToDocx.update({ ocr })}
          />
          <Switch
            label="Keep page breaks"
            description="Each PDF page starts a new page in Word. Off lets the text flow freely."
            checked={pdfToDocx.keepPages}
            onChange={(keepPages) => pdfToDocx.update({ keepPages })}
          />
          {reconvert}
          <p className="text-xs text-muted">
            Text, headings, bold and italic, lists and pictures come across. Complex layouts (columns, text boxes, forms) are simplified
            into plain paragraphs you can edit.
          </p>
        </>
      );
    case 'text-to-pdf':
      return (
        <>
          <Row label="Font">
            <SegmentedControl
              label="Font"
              size="sm"
              value={text.font}
              onChange={(font) => text.update({ font })}
              segments={[
                { value: 'mono', label: 'Monospace' },
                { value: 'sans', label: 'Sans' },
                { value: 'serif', label: 'Serif' },
              ]}
            />
          </Row>
          <Row label="Text size">
            <SegmentedControl
              label="Text size"
              size="sm"
              value={String(text.size) as '9' | '10' | '11' | '12'}
              onChange={(v) => text.update({ size: Number(v) })}
              segments={[
                { value: '9', label: '9 pt' },
                { value: '10', label: '10' },
                { value: '11', label: '11' },
                { value: '12', label: '12' },
              ]}
            />
          </Row>
          <PageSizeRow value={text.page} onChange={(page) => text.update({ page })} />
          {reconvert}
          <p className="text-xs text-muted">
            {text.font === 'mono'
              ? 'Monospace keeps columns, tables drawn with spaces and code lined up exactly. At 10 pt, 80 characters fit on a line.'
              : 'A proportional font reads more like a letter; columns lined up with spaces will not stay straight.'}{' '}
            Markdown files are formatted with headings, lists and tables, and code blocks stay in monospace.
          </p>
        </>
      );
    case 'html-to-pdf':
      return (
        <>
          <PageSizeRow value={html.page} onChange={(page) => html.update({ page })} />
          {reconvert}
          <p className="text-xs text-muted">
            The page is read with its stylesheets, and laid out as a document with selectable text: headings, fonts, colours, tables,
            lists, links and embedded pictures come across, while side-by-side columns are placed one after another. For a PDF that
            looks exactly like the page, use <span className="font-medium text-fg">Exact layout (print)</span> and choose Save as PDF.
          </p>
          <p className="text-xs text-muted">
            Scripts never run. Pictures inside the file are included; pictures it links to on the web or in a folder next to it are not
            fetched.
          </p>
        </>
      );
    case 'rtf-to-pdf':
      return (
        <p className="text-xs text-muted">
          Fonts, sizes, bold, italic, underline, colours, highlighting, headings, lists, tables, links and PNG or JPEG pictures are
          kept, and text stays selectable. Page size and margins follow the document. Headers, footers, footnotes and drawings are not
          included.
        </p>
      );
    default:
      return (
        <p className="text-xs text-muted">
          Headings, bold, italic, underline, colours, lists, tables, links and pictures are kept, and text stays selectable and
          searchable. Page size and margins follow the document. Headers, footers, footnotes and text boxes are not included.
        </p>
      );
  }
}

function SidePanel({ kind }: { kind: ConvertKind }) {
  const store = DOC_QUEUES[kind];
  const jobs = store((s) => s.jobs);
  const done = jobs.filter((j) => j.status === 'done').length;
  const busy = jobs.some((j) => j.status === 'working' || j.status === 'waiting');
  const reconvert = (
    <Button
      className="w-full"
      onClick={() => jobs.forEach((j) => j.status !== 'working' && retryJob(kind, j.id))}
      disabled={busy || !jobs.length}
      icon={<RotateCcw className="h-4 w-4" aria-hidden />}
    >
      Convert again with these options
    </Button>
  );

  return (
    <section aria-labelledby="convert-panel-title" className="card space-y-5 p-5">
      <h2 id="convert-panel-title" className="text-sm font-semibold text-fg">
        {TOOL_BY_ID[kind].name}
      </h2>
      <Options kind={kind} reconvert={reconvert} />
      <div className="h-px bg-border" />
      <Button
        variant="primary"
        className="w-full"
        disabled={!done}
        onClick={() => void downloadAllJobs(kind)}
        icon={busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
      >
        {done > 1 ? `Download all ${done} as ZIP` : 'Download'}
      </Button>
      <Button variant="ghost" className="w-full" onClick={() => store.getState().clear()} disabled={busy} icon={<Trash2 className="h-4 w-4" aria-hidden />}>
        Clear list
      </Button>
    </section>
  );
}

/** Every document converter: a list of files converted one after another, each downloaded on its own. */
export function ConvertWorkspace({ kind }: { kind: ConvertKind }) {
  const store = DOC_QUEUES[kind];
  const { formats, badges, title } = UI[kind];
  const jobs = store((s) => s.jobs);
  const onFiles = (files: FileList) => addToConverter(kind, Array.from(files));

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        addToConverter(kind, Array.from(e.clipboardData.files));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [kind]);

  const dropZone = (compact: boolean) => (
    <FileDropZone inputId={`ck-file-input-${kind}`} accept={acceptAttribute(formats)} badges={badges} onFiles={onFiles} compact={compact} title={title} />
  );

  return (
    <>
      <PasswordDialog />
      <AnimatePresence mode="popLayout" initial={false}>
        {!jobs.length ? (
          <motion.div key="empty" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mx-auto max-w-3xl">
            {dropZone(false)}
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-4">
              <ul className="space-y-3" aria-label="Files">
                {jobs.map((job) => (
                  <JobCard key={job.id} kind={kind} job={job} />
                ))}
              </ul>
              {dropZone(true)}
            </div>
            <div className="lg:sticky lg:top-20">
              <SidePanel kind={kind} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
