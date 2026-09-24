import { ChevronRight } from 'lucide-react';
import { TOOL_BY_ID, type ToolId } from '../../features/catalog';
import { TOOL_CONTENT } from '../../features/toolContent';
import { Link } from '../common/Link';
import { HighlightGrid } from '../sections/HighlightGrid';
import { PrivacyNote } from '../sections/Privacy';
import { StepList } from '../sections/StepList';
import { RelatedTools } from '../tools/ToolGrid';
import { ToolWorkspace } from '../workspace/ToolWorkspace';

/** One page per tool: what it is, the tool itself, then how it works and what it can do. */
export function ToolPage({ id }: { id: ToolId }) {
  const tool = TOOL_BY_ID[id];
  const content = TOOL_CONTENT[id];
  const Icon = content.icon;

  return (
    <>
      <div className="relative overflow-hidden">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <header className="relative mx-auto max-w-6xl px-4 pt-8 pb-8 sm:px-6 sm:pt-10">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-1.5 text-sm text-muted">
              <li>
                <Link to="/" className="rounded hover:text-fg hover:underline">
                  All tools
                </Link>
              </li>
              <li aria-hidden>
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li aria-current="page" className="font-medium text-fg">
                {tool.name}
              </li>
            </ol>
          </nav>
          <div className="mt-5 flex items-center gap-3 sm:gap-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-text sm:h-12 sm:w-12">
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
            </span>
            <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.03em] text-balance text-fg sm:text-4xl">{tool.heading}</h1>
          </div>
          <p className="mt-3 max-w-3xl text-pretty text-muted sm:text-lg">{tool.description}</p>
        </header>
      </div>

      <ToolWorkspace id={id} />

      <div className="mt-20 sm:mt-24">
        <StepList id="how-it-works" eyebrow="How it works" title={`${tool.name} in three steps`} steps={content.steps} />
      </div>
      <HighlightGrid id="features" eyebrow="What it does" title="What you get" items={content.highlights} />
      <RelatedTools id={id} />
      <PrivacyNote />
    </>
  );
}
