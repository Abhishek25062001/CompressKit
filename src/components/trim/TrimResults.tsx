import { motion } from 'framer-motion';
import { CheckCircle2, ChevronDown, Download, Info, Loader2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { formatClock, formatLength } from '../../features/trim/time';
import { canShareParts, downloadAllParts, downloadPart, shareParts } from '../../features/trim/trimJob';
import { useTrimStore, type TrimPart } from '../../store/trimStore';
import { formatBytes, formatElapsed } from '../../utils/format';
import { Button } from '../common/Button';

const ENGINE_LABEL = { copy: 'Lossless copy', webcodecs: 'WebCodecs', ffmpeg: 'FFmpeg.wasm' } as const;

function PartRow({ part, index, total }: { part: TrimPart; index: number; total: number }) {
  const [open, setOpen] = useState(false);
  const shareable = canShareParts([part]);
  return (
    <li className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-mono text-xs font-semibold text-accent-text">
          {total > 1 ? index + 1 : <CheckCircle2 className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-medium text-fg" title={part.fileName}>
            {part.fileName}
          </p>
          <p className="font-mono text-xs text-muted tabular-nums">
            {formatClock(part.start)} – {formatClock(part.end)} · {formatLength(part.end - part.start)} · {formatBytes(part.blob.size)}
          </p>
        </div>
        <div className="flex w-full justify-end gap-1.5 sm:w-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            icon={<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />}
          >
            Preview
          </Button>
          {shareable && (
            <Button variant="secondary" size="sm" onClick={() => void shareParts([part])} icon={<Share2 className="h-3.5 w-3.5" aria-hidden />}>
              Share
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => downloadPart(part)} icon={<Download className="h-3.5 w-3.5" aria-hidden />}>
            Save
          </Button>
        </div>
      </div>
      {open && (
        <div className="border-t border-border bg-black">
          <video src={part.url} controls playsInline className="mx-auto block max-h-80 w-full" />
        </div>
      )}
    </li>
  );
}

export function TrimResults() {
  const { parts, notes, engine, elapsedMs } = useTrimStore(
    useShallow((s) => ({ parts: s.parts, notes: s.notes, engine: s.engine, elapsedMs: s.elapsedMs })),
  );
  const [zipping, setZipping] = useState(false);
  if (parts.length === 0) return null;

  const multiple = parts.length > 1;
  const total = parts.reduce((sum, p) => sum + p.blob.size, 0);
  const shareable = canShareParts(parts);
  const shareAll = multiple && shareable;

  const saveAll = async () => {
    setZipping(true);
    try {
      await downloadAllParts();
    } finally {
      setZipping(false);
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="trim-results-title"
      className="card p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="trim-results-title" className="text-sm font-semibold text-fg">
            {multiple ? `${parts.length} parts ready` : 'Your clip is ready'}
          </h2>
          <p className="text-xs text-muted">
            {formatBytes(total)} · {engine ? ENGINE_LABEL[engine] : ''} · {formatElapsed(elapsedMs)}
          </p>
        </div>
        {multiple && (
          <div className="flex gap-2">
            {shareAll && (
              <Button variant="secondary" onClick={() => void shareParts(parts)} icon={<Share2 className="h-4 w-4" aria-hidden />}>
                Share all
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => void saveAll()}
              disabled={zipping}
              icon={zipping ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            >
              Download all (ZIP)
            </Button>
          </div>
        )}
      </div>
      <ul className="space-y-2">
        {parts.map((part, i) => (
          <PartRow key={part.url} part={part} index={i} total={parts.length} />
        ))}
      </ul>
      {notes.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {notes.map((note) => (
            <li key={note} className="flex gap-2 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      )}
      {shareable && (
        <p className="mt-3 text-xs text-muted">On a phone, Share opens the share sheet: pick WhatsApp, then My status.</p>
      )}
    </motion.section>
  );
}
