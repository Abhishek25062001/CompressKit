import { CATALOG } from '../../features/catalog';
import { Link } from '../common/Link';
import { LogoMark } from './Logo';

const AUTHOR_NAME = 'Abhishek Jaiswal';
const AUTHOR_URL = 'https://abhishekjaiswal.net/';

const linkClass = 'rounded-sm font-medium text-fg underline-offset-4 hover:underline';

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 text-sm text-muted sm:px-6 md:grid-cols-[1.2fr_2fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-5 w-5" />
            <span className="font-medium text-fg">CompressKit</span>
          </div>
          <p className="mt-3 max-w-xs">Private file tools that run in your browser. Your files never leave your device.</p>
          <p className="mt-4 text-xs">
            Video engine: FFmpeg.wasm (GPL). Media parsing: Mediabunny. Background removal: IS-Net on ONNX Runtime.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-[2fr_1fr]">
          <nav aria-labelledby="footer-tools">
            <h2 id="footer-tools" className="text-xs font-semibold tracking-wide text-fg uppercase">
              Tools
            </h2>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              {CATALOG.map((tool) => (
                <li key={tool.id}>
                  <Link to={tool.path} className="hover:text-fg hover:underline">
                    {tool.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-labelledby="footer-about">
            <h2 id="footer-about" className="text-xs font-semibold tracking-wide text-fg uppercase">
              About
            </h2>
            <ul className="mt-3 space-y-2">
              <li>
                <Link to="/#how-it-works" className="hover:text-fg hover:underline">
                  How it works
                </Link>
              </li>
              <li>
                <Link to="/#privacy" className="hover:text-fg hover:underline">
                  Privacy
                </Link>
              </li>
            
            </ul>
          </nav>
        </div>
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
          
            <span>© {new Date().getFullYear()} {AUTHOR_NAME}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
