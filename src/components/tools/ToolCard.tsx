import { ArrowUpRight } from 'lucide-react';
import type { FileKind, ToolInfo } from '../../features/catalog';
import { TOOL_CONTENT } from '../../features/toolContent';
import { cn } from '../../utils/cn';
import { Link } from '../common/Link';

const KIND_LABEL: Record<FileKind, string> = { image: 'Photos', video: 'Videos', pdf: 'PDFs', word: 'Word', document: 'Documents', sheet: 'Spreadsheets', slides: 'Slides' };

interface ToolCardProps {
  tool: ToolInfo;
  className?: string;
}

export function ToolCard({ tool, className }: ToolCardProps) {
  const Icon = TOOL_CONTENT[tool.id].icon;
  return (
    <Link
      to={tool.path}
      className={cn(
        'card group relative flex h-full flex-col p-5 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[var(--shadow-soft)] sm:p-6',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent-text transition-colors group-hover:bg-accent group-hover:text-accent-fg">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <ArrowUpRight className="h-5 w-5 text-subtle transition-[color,transform] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent-text" aria-hidden />
      </div>
      <h3 className="mt-4 font-semibold text-fg">{tool.name}</h3>
      <p className="mt-1 text-sm text-muted">{tool.tagline}</p>
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-4">
        {tool.handles.map((kind) => (
          <span key={kind} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">
            {KIND_LABEL[kind]}
          </span>
        ))}
      </div>
    </Link>
  );
}
