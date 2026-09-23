import { LogoMark } from './Logo';

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
    </footer>
  );
}
