import { Link } from '../common/Link';
import { ToolGrid } from '../tools/ToolGrid';

export function NotFoundPage() {
  return (
    <>
      <div className="mx-auto max-w-2xl px-4 pt-20 text-center sm:px-6">
        <p className="font-mono text-xs tracking-[0.18em] text-accent-text uppercase">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-fg sm:text-4xl">This page does not exist</h1>
        <p className="mt-3 text-muted">
          The link may be old or mistyped. Every tool is listed below, or go to the{' '}
          <Link to="/" className="font-medium text-accent-text hover:underline">
            home page
          </Link>
          .
        </p>
      </div>
      <ToolGrid />
    </>
  );
}
