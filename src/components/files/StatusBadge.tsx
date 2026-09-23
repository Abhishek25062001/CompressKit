import { CheckCircle2, CircleDashed, Loader2, Ban, XCircle } from 'lucide-react';
import type { FileStatus } from '../../types/media';
import { cn } from '../../utils/cn';

const CONFIG: Record<FileStatus, { label: string; className: string; Icon: typeof CheckCircle2; spin?: boolean }> = {
  waiting: { label: 'Waiting', className: 'bg-surface-2 text-muted', Icon: CircleDashed },
  compressing: { label: 'Compressing', className: 'bg-accent-soft text-accent-text', Icon: Loader2, spin: true },
  completed: { label: 'Completed', className: 'bg-accent-soft text-accent-text', Icon: CheckCircle2 },
  failed: { label: 'Failed', className: 'bg-danger-soft text-danger', Icon: XCircle },
  cancelled: { label: 'Cancelled', className: 'bg-surface-2 text-muted', Icon: Ban },
};

/** `activeLabel` replaces "Compressing" for tools that do something else, such as converting. */
export function StatusBadge({ status, activeLabel }: { status: FileStatus; activeLabel?: string }) {
  const { className, Icon, spin } = CONFIG[status];
  const label = status === 'compressing' && activeLabel ? activeLabel : CONFIG[status].label;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>
      <Icon className={cn('h-3 w-3', spin && 'animate-spin')} aria-hidden />
      {label}
    </span>
  );
}
