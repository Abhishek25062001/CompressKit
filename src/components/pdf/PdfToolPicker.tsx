import { ArrowRight } from 'lucide-react';
import { PDF_TOOLS, type PdfTab } from './pdfTools';

/** The PDF page's starting point: every tool at a glance, before any file is asked for. */
export function PdfToolPicker({ onPick }: { onPick: (tab: PdfTab) => void }) {
  return (
    <section aria-labelledby="pdf-picker-title">
      <h2 id="pdf-picker-title" className="mb-4 text-lg font-semibold tracking-tight text-fg">
        What would you like to do?
      </h2>
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {PDF_TOOLS.map((tool) => (
          <li key={tool.value}>
            <button
              type="button"
              onClick={() => onPick(tool.value)}
              className="card group flex h-full w-full flex-col items-start p-3 text-left sm:p-4 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-[var(--shadow-soft)]"
            >
              <span className="flex w-full items-start justify-between gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-text transition-colors group-hover:bg-accent group-hover:text-accent-fg">
                  <tool.icon className="h-5 w-5" aria-hidden />
                </span>
                <ArrowRight
                  className="hidden h-4 w-4 text-subtle sm:block transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-accent-text"
                  aria-hidden
                />
              </span>
              <span className="mt-3 text-sm font-semibold text-fg">{tool.name}</span>
              {/* Phones show names only, so all eleven tools fit on about one screen. */}
              <span className="mt-1 hidden text-[13px] text-muted sm:block">{tool.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
