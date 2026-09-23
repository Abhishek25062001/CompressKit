import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Info, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useUiStore, type Notice } from '../../store/uiStore';
import { cn } from '../../utils/cn';

function NoticeItem({ notice }: { notice: Notice }) {
  const dismiss = useUiStore((s) => s.dismissNotice);
  useEffect(() => {
    const t = setTimeout(() => dismiss(notice.id), 7000);
    return () => clearTimeout(t);
  }, [notice.id, dismiss]);

  const Icon = notice.tone === 'error' ? XCircle : notice.tone === 'warning' ? AlertTriangle : Info;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24 }}
      className="card pointer-events-auto flex w-full items-start gap-3 p-3.5 shadow-lg"
    >
      <Icon
        aria-hidden
        className={cn(
          'mt-0.5 h-4.5 w-4.5 shrink-0',
          notice.tone === 'error' ? 'text-danger' : notice.tone === 'warning' ? 'text-warning' : 'text-accent-text',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{notice.title}</p>
        {notice.message && <p className="mt-0.5 text-xs break-words text-muted">{notice.message}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(notice.id)}
        aria-label="Dismiss notification"
        className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

export function Notices() {
  const notices = useUiStore((s) => s.notices);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96"
    >
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <NoticeItem key={n.id} notice={n} />
        ))}
      </AnimatePresence>
    </div>
  );
}
