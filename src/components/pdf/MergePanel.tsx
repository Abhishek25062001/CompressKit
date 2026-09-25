import { Download, FileStack, FileText, Layers } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { mergeWordFiles } from '../../features/docs/actions';
import { savePdf } from '../../features/pdf/actions';
import { usePdfStore } from '../../store/pdfStore';
import { Button } from '../common/Button';
import { Link } from '../common/Link';

/**
 * Merge documents: everything on the board becomes one PDF in board order. When every file is a
 * Word document they can also be joined into one Word file, which keeps the text editable.
 */
export function MergePanel() {
  const { pages, files, words, busy } = usePdfStore(
    useShallow((s) => ({
      pages: s.pages,
      files: Object.keys(s.sources).length,
      words: Object.keys(s.wordDocs).length,
      busy: s.busy !== null,
    })),
  );
  const allWord = files > 0 && words === files;
  const count = `${pages.length} page${pages.length === 1 ? '' : 's'}`;

  return (
    <section aria-labelledby="merge-panel-title" className="card space-y-5 p-5">
      <h2 id="merge-panel-title" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Layers className="h-4 w-4 text-accent-text" aria-hidden />
        Merge {files} file{files === 1 ? '' : 's'}
      </h2>
      <p className="text-xs text-muted">
        Pages are joined in the order on the board. Drag pages to reorder them, and remove the ones you don&apos;t need. Word files are
        laid out as pages first.
      </p>
      <Button
        variant="primary"
        className="w-full"
        disabled={busy || !pages.length}
        onClick={() => void savePdf(pages)}
        icon={<Download className="h-4 w-4" aria-hidden />}
      >
        Merge into one PDF ({count})
      </Button>
      {allWord && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-2/40 p-3">
          <Button className="w-full" disabled={busy} onClick={mergeWordFiles} icon={<FileText className="h-4 w-4" aria-hidden />}>
            Merge into one Word file
          </Button>
          <p className="text-xs text-muted">
            Joins the documents in the order they first appear on the board, each starting on a new page, and keeps the text editable.
            Removing or moving single pages only changes the PDF.
          </p>
        </div>
      )}
      {files < 2 && <p className="text-xs text-muted">Add at least one more file to merge.</p>}
      <p className="flex gap-2 text-xs text-muted">
        <FileStack className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Need page numbers, a watermark, compression or a password?{' '}
          <Link to="/pdf" className="font-medium text-accent-text hover:underline">
            Open these pages in PDF tools
          </Link>
          .
        </span>
      </p>
    </section>
  );
}
