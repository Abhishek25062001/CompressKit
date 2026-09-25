import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Download,
  FilePlus2,
  FileText,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Palette,
  Redo2,
  RemoveFormatting,
  SeparatorHorizontal,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { openInEditor } from '../../features/docs/actions';
import { writeDocx } from '../../features/docs/docxWrite';
import { addImage, createImageStore, docToHtml, htmlToDoc, imageTag, releaseImages } from '../../features/docs/html';
import { countWords, type DocModel } from '../../features/docs/model';
import { canvasToBlob, createCanvas, getContext, releaseCanvas } from '../../features/image/canvas';
import { decodeImage } from '../../features/image/decode';
import { useDocEditorStore } from '../../store/docsStore';
import { useUiStore } from '../../store/uiStore';
import { downloadBlob } from '../../utils/download';
import { cn } from '../../utils/cn';
import { Button } from '../common/Button';
import { PasswordDialog } from '../pdf/PasswordDialog';
import { FileDropZone } from '../upload/DropZone';

const ACCEPT = '.docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf';

const BLOCK_STYLES = [
  { value: 'p', label: 'Normal text' },
  { value: 'h1', label: 'Title' },
  { value: 'h2', label: 'Heading 1' },
  { value: 'h3', label: 'Heading 2' },
  { value: 'h4', label: 'Heading 3' },
  { value: 'blockquote', label: 'Quote' },
];
const FONTS = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Sans serif' },
  { value: '"Times New Roman", Times, serif', label: 'Serif' },
  { value: '"Courier New", Courier, monospace', label: 'Monospace' },
];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

/** Runs a formatting command on the editable area. execCommand is old but still the only way to edit rich text with the browser's own undo history. */
function exec(command: string, value?: string): void {
  document.execCommand('styleWithCSS', false, 'true');
  document.execCommand(command, false, value);
}

function ToolButton({ label, icon: Icon, onClick, active }: { label: string; icon: LucideIcon; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Keep the text selection in the document when a toolbar button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-accent-soft text-accent-text' : 'text-muted hover:bg-surface-2 hover:text-fg',
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

function ColorButton({ label, icon: Icon, onPick }: { label: string; icon: LucideIcon; onPick: (color: string) => void }) {
  return (
    <label
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      className="relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <Icon className="h-4 w-4" aria-hidden />
      <input type="color" aria-label={label} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  );
}

function ToolbarSelect({ label, value, options, onChange, className }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; className?: string }) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-8 shrink-0 rounded-lg border border-border bg-surface px-2 text-xs text-fg hover:border-border-strong', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Pictures go into documents as JPEG or PNG, at most 2000 pixels on the long side. */
async function readPicture(file: File) {
  const bitmap = await decodeImage(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = createCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  getContext(canvas).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const size = { w: bitmap.width, h: bitmap.height };
  bitmap.close();
  const png = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
  const blob = await canvasToBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.9);
  releaseCanvas(canvas);
  return { data: new Uint8Array(await blob.arrayBuffer()), mime: (png ? 'image/png' : 'image/jpeg') as 'image/png' | 'image/jpeg', ...size };
}

function Editor({ doc, name }: { doc: DocModel; name: string }) {
  const version = useDocEditorStore((s) => s.version);
  const warnings = useDocEditorStore((s) => s.warnings);
  const areaRef = useRef<HTMLDivElement>(null);
  const images = useRef(createImageStore());
  const fileRef = useRef<HTMLInputElement>(null);
  const [block, setBlock] = useState('p');
  const [marks, setMarks] = useState({ bold: false, italic: false, underline: false, strike: false, ul: false, ol: false, align: 'left' });
  const [words, setWords] = useState(() => countWords(doc));
  const [saving, setSaving] = useState<string | null>(null);
  const [fileName, setFileName] = useState(name);

  // Load the document into the editable area whenever a new one is opened.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    releaseImages(images.current);
    area.innerHTML = docToHtml(doc, images.current);
    setWords(countWords(doc));
    setFileName(name);
    area.focus();
    const store = images.current;
    return () => releaseImages(store);
    // The document is replaced only when a new one is opened, never while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const current = useCallback((): DocModel => htmlToDoc(areaRef.current!, images.current, doc.page), [doc.page]);

  // Reflect the formatting at the caret in the toolbar.
  useEffect(() => {
    const onSelection = () => {
      const area = areaRef.current;
      const sel = document.getSelection();
      if (!area || !sel?.anchorNode || !area.contains(sel.anchorNode)) return;
      let node: Node | null = sel.anchorNode;
      let tag = 'p';
      while (node && node !== area) {
        if (node instanceof HTMLElement && /^(P|H1|H2|H3|H4|BLOCKQUOTE|LI|DIV)$/.test(node.tagName)) {
          tag = node.tagName === 'LI' || node.tagName === 'DIV' ? 'p' : node.tagName.toLowerCase();
          break;
        }
        node = node.parentNode;
      }
      setBlock(tag);
      setMarks({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strike: document.queryCommandState('strikeThrough'),
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
        align: document.queryCommandState('justifyCenter')
          ? 'center'
          : document.queryCommandState('justifyRight')
            ? 'right'
            : document.queryCommandState('justifyFull')
              ? 'justify'
              : 'left',
      });
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  // Warn before leaving with unsaved edits.
  const dirty = useRef(false);
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  const run = (command: string, value?: string) => {
    areaRef.current?.focus();
    exec(command, value);
    dirty.current = true;
  };

  const setFontSize = (pt: string) => {
    areaRef.current?.focus();
    // execCommand only knows sizes 1-7; mark the text with 7, then swap in the real size.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand('fontSize', false, '7');
    areaRef.current?.querySelectorAll('font[size="7"]').forEach((font) => {
      const span = document.createElement('span');
      span.style.fontSize = `${pt}pt`;
      span.append(...Array.from(font.childNodes));
      font.replaceWith(span);
    });
    dirty.current = true;
  };

  const insertHtml = (html: string) => {
    areaRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    dirty.current = true;
  };

  const addLink = () => {
    const url = window.prompt('Link address (https://…)');
    if (!url) return;
    const safe = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    run('createLink', safe);
  };

  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      const pic = await readPicture(file);
      const content = doc.page.width - doc.page.margin.left - doc.page.margin.right;
      // Pictures start at their size at 150 DPI, no wider than the text.
      const width = Math.min(content, (pic.w * 72) / 150);
      const height = (width * pic.h) / pic.w;
      const id = addImage(images.current, { type: 'image', data: pic.data, mime: pic.mime, width, height });
      insertHtml(imageTag(id, images.current, width, height));
    } catch {
      useUiStore.getState().pushNotice({ tone: 'error', title: "Couldn't add that picture", message: 'Try a JPG or PNG.' });
    }
  };

  const save = async (format: 'docx' | 'pdf') => {
    const base = fileName.trim() || 'document';
    setSaving(format === 'pdf' ? 'Making PDF' : 'Saving');
    try {
      const model = current();
      if (format === 'docx') downloadBlob(writeDocx(model, base), `${base}.docx`);
      else {
        const { layoutPdf } = await import('../../features/docs/pdfLayout');
        const { bytes } = await layoutPdf(model, { title: base });
        downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), `${base}.pdf`);
      }
      dirty.current = false;
    } catch (e) {
      console.warn('[CompressKit] saving document failed:', e);
      useUiStore.getState().pushNotice({ tone: 'error', title: 'Could not save', message: 'Something in the document could not be written.' });
    } finally {
      setSaving(null);
    }
  };

  const close = () => {
    if (dirty.current && !window.confirm('Close this document? Changes you have not downloaded will be lost.')) return;
    dirty.current = false;
    useDocEditorStore.getState().set({ doc: null, name: null, warnings: [] });
  };

  // The sheet is the document's page at 100%, in points, as Word shows it.
  const { page } = doc;
  const sheet = {
    maxWidth: `${page.width}pt`,
    minHeight: `${page.height * 0.5}pt`,
    '--doc-pad': `${page.margin.top}pt ${page.margin.right}pt ${page.margin.bottom}pt ${page.margin.left}pt`,
  } as React.CSSProperties;

  return (
    <div className="space-y-3">
      <div className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-accent-text" aria-hidden />
          <input
            aria-label="File name"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-sm font-semibold text-fg hover:border-border focus-visible:border-accent"
          />
          <span className="hidden shrink-0 text-xs text-muted sm:inline" aria-live="polite">
            {words} word{words === 1 ? '' : 's'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={!!saving} onClick={() => void save('docx')} icon={<Download className="h-3.5 w-3.5" aria-hidden />}>
            Word (.docx)
          </Button>
          <Button size="sm" disabled={!!saving} onClick={() => void save('pdf')} icon={saving === 'Making PDF' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Download className="h-3.5 w-3.5" aria-hidden />}>
            PDF
          </Button>
          <Button variant="ghost" size="sm" onClick={close} icon={<X className="h-3.5 w-3.5" aria-hidden />}>
            Close
          </Button>
        </div>
      </div>

      {warnings.length > 0 && (
        <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
          Some parts of this file can&apos;t be edited here and were left out: {warnings.join(', ')}. Saving writes a new document
          without them.
        </p>
      )}

      <div role="toolbar" aria-label="Formatting" className="card sticky top-16 z-20 flex items-center gap-0.5 overflow-x-auto p-1.5 md:flex-wrap md:overflow-visible">
        <ToolButton label="Undo" icon={Undo2} onClick={() => run('undo')} />
        <ToolButton label="Redo" icon={Redo2} onClick={() => run('redo')} />
        <Divider />
        <ToolbarSelect label="Paragraph style" value={block} options={BLOCK_STYLES} onChange={(v) => run('formatBlock', v)} className="w-32" />
        <ToolbarSelect label="Font" value="" options={[{ value: '', label: 'Font' }, ...FONTS]} onChange={(v) => v && run('fontName', v)} className="w-28" />
        <ToolbarSelect
          label="Font size"
          value=""
          options={[{ value: '', label: 'Size' }, ...SIZES.map((s) => ({ value: String(s), label: `${s} pt` }))]}
          onChange={(v) => v && setFontSize(v)}
          className="w-20"
        />
        <Divider />
        <ToolButton label="Bold (Ctrl+B)" icon={Bold} active={marks.bold} onClick={() => run('bold')} />
        <ToolButton label="Italic (Ctrl+I)" icon={Italic} active={marks.italic} onClick={() => run('italic')} />
        <ToolButton label="Underline (Ctrl+U)" icon={Underline} active={marks.underline} onClick={() => run('underline')} />
        <ToolButton label="Strikethrough" icon={Strikethrough} active={marks.strike} onClick={() => run('strikeThrough')} />
        <ColorButton label="Text colour" icon={Palette} onPick={(c) => run('foreColor', c)} />
        <ColorButton label="Highlight colour" icon={Highlighter} onPick={(c) => run('hiliteColor', c)} />
        <Divider />
        <ToolButton label="Align left" icon={AlignLeft} active={marks.align === 'left'} onClick={() => run('justifyLeft')} />
        <ToolButton label="Center" icon={AlignCenter} active={marks.align === 'center'} onClick={() => run('justifyCenter')} />
        <ToolButton label="Align right" icon={AlignRight} active={marks.align === 'right'} onClick={() => run('justifyRight')} />
        <ToolButton label="Justify" icon={AlignJustify} active={marks.align === 'justify'} onClick={() => run('justifyFull')} />
        <Divider />
        <ToolButton label="Bulleted list" icon={List} active={marks.ul} onClick={() => run('insertUnorderedList')} />
        <ToolButton label="Numbered list" icon={ListOrdered} active={marks.ol} onClick={() => run('insertOrderedList')} />
        <ToolButton label="Decrease indent" icon={IndentDecrease} onClick={() => run('outdent')} />
        <ToolButton label="Increase indent" icon={IndentIncrease} onClick={() => run('indent')} />
        <Divider />
        <ToolButton label="Link" icon={Link2} onClick={addLink} />
        <ToolButton label="Picture" icon={ImagePlus} onClick={() => fileRef.current?.click()} />
        <ToolButton
          label="Table"
          icon={Table2}
          onClick={() => insertHtml(`<table><tbody>${'<tr><td><p><br></p></td><td><p><br></p></td><td><p><br></p></td></tr>'.repeat(3)}</tbody></table><p><br></p>`)}
        />
        <ToolButton label="Page break" icon={SeparatorHorizontal} onClick={() => insertHtml('<hr class="doc-page-break" contenteditable="false"><p><br></p>')} />
        <ToolButton label="Clear formatting" icon={RemoveFormatting} onClick={() => run('removeFormat')} />
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => {
          void addPicture(e.target.files?.[0]);
          e.target.value = '';
        }} />
      </div>

      <div className="overflow-x-auto rounded-2xl bg-surface-2/60 p-3 sm:p-8">
        <div
          ref={areaRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Document"
          spellCheck
          onInput={() => {
            dirty.current = true;
            setWords(areaRef.current?.innerText.split(/\s+/).filter(Boolean).length ?? 0);
          }}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              void addPicture(file);
            }
          }}
          onDrop={(e) => {
            const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              void addPicture(file);
            }
          }}
          className="doc-sheet mx-auto bg-white text-black shadow-[0_1px_3px_rgb(0_0_0/0.12),0_12px_32px_-12px_rgb(0_0_0/0.25)] outline-none"
          style={sheet}
        />
      </div>
    </div>
  );
}

function Start({ onFiles }: { onFiles: (files: FileList) => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <FileDropZone inputId="ck-file-input-edit-docx" accept={ACCEPT} badges={['DOCX', 'PDF']} onFiles={onFiles} title="Drop a Word document or PDF" />
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
        or
        <Button size="sm" onClick={() => void openInEditor(null)} icon={<FilePlus2 className="h-3.5 w-3.5" aria-hidden />}>
          Start a blank document
        </Button>
      </div>
    </div>
  );
}

export function DocxEditor() {
  const doc = useDocEditorStore((s) => s.doc);
  const name = useDocEditorStore((s) => s.name);
  const loading = useDocEditorStore((s) => s.loading);
  const onFiles = (files: FileList) => {
    const file = files[0];
    if (!file) return;
    if (doc && !window.confirm('Open another document? Changes you have not downloaded will be lost.')) return;
    void openInEditor(file);
  };

  let content: ReactNode;
  if (loading) {
    content = (
      <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {loading}…
      </p>
    );
  } else if (doc && name) content = <Editor doc={doc} name={name} />;
  else content = <Start onFiles={onFiles} />;

  return (
    <>
      <PasswordDialog />
      {content}
    </>
  );
}
