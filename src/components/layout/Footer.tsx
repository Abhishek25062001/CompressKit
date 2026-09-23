import { LogoMark } from './Logo';

const AUTHOR_NAME = 'Abhishek Jaiswal';
const AUTHOR_URL = 'https://github.com/Abhishek25062001';
const REPO_URL = 'https://github.com/Abhishek25062001/CompressKit';

const linkClass = 'rounded-sm font-medium text-fg underline-offset-4 hover:underline';

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-5 w-5" />
          <span>
            <span className="font-medium text-fg">CompressKit</span> · Compress your media. Keep your privacy.
          </span>
        </div>
        <p className="text-xs">
          Video engine: FFmpeg.wasm (GPL). Media parsing: Mediabunny. Processing happens in your browser.
        </p>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:items-center sm:px-6">
          <p>
            Designed &amp; developed by{' '}
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
              {AUTHOR_NAME}
            </a>
          </p>
          <p className="flex items-center gap-4">
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
              Source on GitHub
            </a>
            <span>© {new Date().getFullYear()} {AUTHOR_NAME}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
