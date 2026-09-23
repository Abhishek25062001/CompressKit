import { motion } from 'framer-motion';
import { cn } from '../../utils/cn';

interface ProgressBarProps {
  /** 0..1, or null for an honest indeterminate state. */
  value: number | null;
  label: string;
  className?: string;
}

export function ProgressBar({ value, label, className }: ProgressBarProps) {
  const determinate = value !== null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={determinate ? Math.round(value * 100) : undefined}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      {determinate ? (
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
          initial={false}
          animate={{ width: `${Math.max(2, value * 100)}%` }}
          transition={{ type: 'tween', ease: 'easeOut', duration: 0.3 }}
        />
      ) : (
        <div className="animate-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-gradient-to-r from-transparent via-accent to-transparent" />
      )}
    </div>
  );
}
