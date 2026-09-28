import { ArrowRight, FileImage, Images, type LucideIcon } from 'lucide-react';
import { CATALOG } from '../../features/catalog';
import { TOOL_CONTENT } from '../../features/toolContent';
import { cn } from '../../utils/cn';
import { Link } from '../common/Link';
import { SectionHeading } from '../sections/SectionHeading';

interface ConverterLink {
  key: string;
  name: string;
  formats: string;
  to: string;
  icon: LucideIcon;
}

/** Picture conversions live in PDF tools; these links open it with the right tool picked. */
const PICTURES_TO_PDF: ConverterLink = { key: 'images-to-pdf', name: 'Images to PDF', formats: 'JPG · PNG · HEIC · TIFF · GIF · BMP', to: '/pdf#save', icon: Images };
const PDF_TO_PICTURES: ConverterLink = { key: 'pdf-to-images', name: 'PDF to images', formats: 'JPG · PNG · BMP · TIFF', to: '/pdf#images', icon: FileImage };

function linksFor(direction: 'to-pdf' | 'from-pdf'): ConverterLink[] {
  const tools = CATALOG.filter((t) => t.converts === direction).map((t) => ({
    key: t.id,
    name: t.name,
    formats: t.formats,
    to: t.path,
    icon: TOOL_CONTENT[t.id].icon,
  }));
  return direction === 'to-pdf' ? [PICTURES_TO_PDF, ...tools] : [...tools, PDF_TO_PICTURES];
}

const CONVERT_GROUPS = [
  { direction: 'to-pdf', title: 'Convert to PDF' },
  { direction: 'from-pdf', title: 'Convert from PDF' },
] as const;

function Column({ direction, title, compact, onNavigate }: { direction: 'to-pdf' | 'from-pdf'; title: string; compact?: boolean; onNavigate?: () => void }) {
  return (
    <div>
      <h3 className={cn('font-semibold tracking-wide text-muted uppercase', compact ? 'mb-1 px-2.5 text-[11px]' : 'mb-3 text-xs')}>{title}</h3>
      <ul className={compact ? 'space-y-0.5' : 'space-y-1'}>
        {linksFor(direction).map((link) => (
          <li key={link.key}>
            <Link
              to={link.to}
              onClick={onNavigate}
              className={cn('group flex items-center gap-3 rounded-xl transition-colors hover:bg-surface-2', compact ? 'p-2' : 'p-2.5')}
            >
              <span className={cn('inline-flex shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-text', compact ? 'h-7 w-7' : 'h-9 w-9')}>
                <link.icon className={compact ? 'h-3.5 w-3.5' : 'h-4.5 w-4.5'} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-fg">{link.name}</span>
                {!compact && <span className="block truncate text-xs text-muted">{link.formats}</span>}
              </span>
              {!compact && (
                <ArrowRight className="h-4 w-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" aria-hidden />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every conversion to and from PDF, in two columns: on the home page, and compact in the tools menu. */
export function ConverterLinks({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  if (compact) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {CONVERT_GROUPS.map((g) => (
          <Column key={g.direction} {...g} compact onNavigate={onNavigate} />
        ))}
      </div>
    );
  }
  return (
    <section aria-labelledby="converters-title" id="converters" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-16 sm:px-6 sm:pb-20">
      <SectionHeading
        id="converters-title"
        eyebrow="Converters"
        title="Convert to and from PDF"
        description="Documents, web pages and pictures in, PDFs out, and back again. Every conversion runs on your device."
      />
      <div className="card grid gap-6 p-4 sm:grid-cols-2 sm:p-6">
        {CONVERT_GROUPS.map((g) => (
          <Column key={g.direction} {...g} />
        ))}
      </div>
    </section>
  );
}
