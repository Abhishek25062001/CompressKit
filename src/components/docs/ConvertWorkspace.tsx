import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Download, FileText, FileType2, Loader2, PenSquare, RotateCcw, Trash2, X } from 'lucide-react';
import { useEffect } from 'react';
import { addDocxToPdf, addPdfToDocx, downloadAllJobs, openInEditor, retryJob } from '../../features/docs/actions';
import { useDocxToPdfStore, usePdfToDocxSettings, usePdfToDocxStore, type DocJob } from '../../store/docsStore';
import { useRouteStore } from '../../store/routeStore';
import { downloadBlob } from '../../utils/download';
import { formatBytes } from '../../utils/format';
import { Button } from '../common/Button';
import { ProgressBar } from '../common/ProgressBar';
import { Switch } from '../common/Switch';
import { PasswordDialog } from '../pdf/PasswordDialog';
import { FileDropZone } from '../upload/DropZone';

export type ConvertKind = 'docx-to-pdf' | 'pdf-to-docx';

const CONFIG = {
  'docx-to-pdf': {
    store: useDocxToPdfStore,
    add: addDocxToPdf,
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    badges: ['DOCX'],
    title: 'Drop Word documents here',
    from: 'Word',
    to: 'PDF',
  },
  'pdf-to-docx': {
    store: usePdfToDocxStore,
    add: addPdfToDocx,
    accept: '.pdf,application/pdf',
    badges: ['PDF'],
    title: 'Drop PDFs here',
    from: 'PDF',
    to: 'Word',
  },
} as const;

function JobCard({ kind, job }: { kind: ConvertKind; job: DocJob }) {
  const { store } = CONFIG[kind];
  const navigate = useRouteStore((s) => s.navigate);
  const edit = () => {
    // Word to PDF edits the original; PDF to Word edits the converted document.
    const file = kind === 'docx-to-pdf' ? job.file : job.result && new File([job.result.blob], job.result.name, { type: job.result.blob.type });
    if (!file) return;
    void openInEditor(file);
    navigate('/edit-docx');
  };
  const Icon = kind === 'docx-to-pdf' ? FileType2 : FileText;
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
              Download {CONFIG[kind].to}
            </Button>
          )}
          {(kind === 'docx-to-pdf' || job.result) && job.status === 'done' && (
            <Button size="sm" onClick={edit} icon={<PenSquare className="h-3.5 w-3.5" aria-hidden />}>
              {kind === 'docx-to-pdf' ? 'Edit document' : 'Edit in browser'}
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

function SidePanel({ kind }: { kind: ConvertKind }) {
  const { store } = CONFIG[kind];
  const jobs = store((s) => s.jobs);
  const settings = usePdfToDocxSettings();
  const done = jobs.filter((j) => j.status === 'done').length;
  const busy = jobs.some((j) => j.status === 'working' || j.status === 'waiting');
  const reconvert = () => jobs.forEach((j) => j.status !== 'working' && retryJob(kind, j.id));

  return (
    <section aria-labelledby="convert-panel-title" className="card space-y-5 p-5">
      <h2 id="convert-panel-title" className="text-sm font-semibold text-fg">
        {CONFIG[kind].from} to {CONFIG[kind].to}
      </h2>
      {kind === 'pdf-to-docx' ? (
        <>
          <Switch
            label="Include pictures"
            description="Photos and logos in the PDF are placed in the document where they appear."
            checked={settings.images}
            onChange={(images) => settings.update({ images })}
          />
          <Switch
            label="Read scanned pages (OCR)"
            description="Pages that are photos or scans are read into editable text (English). Off keeps them as pictures."
            checked={settings.ocr}
            onChange={(ocr) => settings.update({ ocr })}
          />
          <Switch
            label="Keep page breaks"
            description="Each PDF page starts a new page in Word. Off lets the text flow freely."
            checked={settings.keepPages}
            onChange={(keepPages) => settings.update({ keepPages })}
          />
          <Button className="w-full" onClick={reconvert} disabled={busy || !jobs.length} icon={<RotateCcw className="h-4 w-4" aria-hidden />}>
            Convert again with these options
          </Button>
          <p className="text-xs text-muted">
            Text, headings, bold and italic, lists and pictures come across. Complex layouts (columns, text boxes, forms) are simplified
            into plain paragraphs you can edit.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted">
          Headings, bold, italic, underline, colours, lists, tables, links and pictures are kept, and text stays selectable and
          searchable. Page size and margins follow the document. Headers, footers, footnotes and text boxes are not included.
        </p>
      )}
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

/** Word to PDF and PDF to Word: a list of files converted one after another, each downloaded on its own. */
export function ConvertWorkspace({ kind }: { kind: ConvertKind }) {
  const { store, add, accept, badges, title } = CONFIG[kind];
  const jobs = store((s) => s.jobs);
  const onFiles = (files: FileList) => add(Array.from(files));

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.clipboardData?.files.length) {
        e.preventDefault();
        add(Array.from(e.clipboardData.files));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [add]);

  const dropZone = (compact: boolean) => (
    <FileDropZone inputId={`ck-file-input-${kind}`} accept={accept} badges={[...badges]} onFiles={onFiles} compact={compact} title={title} />
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
