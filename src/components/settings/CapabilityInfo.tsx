import { Check, ChevronRight, Minus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useCapabilitiesStore } from '../../store/capabilitiesStore';

function Row({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-muted">{label}</span>
      <span className={ok ? 'inline-flex items-center gap-1 text-accent-text' : 'inline-flex items-center gap-1 text-subtle'}>
        {ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
        {detail ?? (ok ? 'Yes' : 'No')}
      </span>
    </li>
  );
}

export function CapabilityInfo() {
  const { browser, image, video, ready } = useCapabilitiesStore(
    useShallow((s) => ({ browser: s.browser, image: s.image, video: s.video, ready: s.ready })),
  );
  const hwCodecs = Object.entries(video.webcodecs)
    .filter(([, ok]) => ok)
    .map(([c]) => c.toUpperCase());

  return (
    <details className="group rounded-xl border border-border bg-surface-2/50 px-4 py-3 text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-fg">
        Browser capabilities
        <ChevronRight className="h-4 w-4 text-muted transition-transform group-open:rotate-90" aria-hidden />
      </summary>
      {ready ? (
        <ul className="mt-2 divide-y divide-border">
          <Row label="Web Workers" ok={browser.workers} />
          <Row label="OffscreenCanvas" ok={browser.offscreenCanvas} detail={browser.offscreenCanvas ? 'Yes' : 'Main thread'} />
          <Row label="WebP encoding" ok={image.webp} />
          <Row label="AVIF encoding" ok detail={image.avifNative ? 'Native' : 'WebAssembly'} />
          <Row label="WebCodecs" ok={browser.webCodecs} />
          <Row label="Hardware video codecs" ok={hwCodecs.length > 0} detail={hwCodecs.length ? hwCodecs.join(', ') : 'None'} />
          <Row label="FFmpeg.wasm" ok={browser.webAssembly} detail={browser.webAssembly ? 'H.264, VP8' : 'No'} />
        </ul>
      ) : (
        <p className="mt-2 text-muted">Checking…</p>
      )}
    </details>
  );
}
