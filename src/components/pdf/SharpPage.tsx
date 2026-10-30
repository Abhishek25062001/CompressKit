import type { PDFPageProxy } from 'pdfjs-dist';
import { useEffect, useRef, type RefObject } from 'react';
import { getContext, releaseCanvas, type AnyCanvas } from '../../features/image/canvas';
import { getOpenPdf } from '../../features/pdf/documents';
import { renderPage, renderPdfRegion, type PageRegion } from '../../features/pdf/render';
import { usePdfStore } from '../../store/pdfStore';
import type { PdfPage } from '../../types/pdf';

/** Waits for zooming and scrolling to pause, so a redraw is not started on every frame. */
const SETTLE_MS = 150;
/** Most pixels redrawn at once. A retina window at full size is about this much. */
const MAX_PIXELS = 12_000_000;
const MAX_PIXEL_RATIO = 2;
/** Extra area drawn around the visible part, as a share of the view, so short pans stay sharp. */
const MARGIN = 0.1;
/** The page picture is fine until it would be stretched by more than this. */
const STRETCH_LIMIT = 1.1;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The page picture is a fixed size, so it blurs when zoomed in. This layer sits on top of it and
 * redraws what is on screen at the screen's own resolution once zooming or scrolling pauses. It
 * is placed in percentages of the page, so it stays aligned while a pinch is still under way.
 */
export function SharpPage({ page, previewWidth, boxRef, viewRef }: {
  page: PdfPage;
  previewWidth: number;
  boxRef: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<HTMLDivElement | null>;
}) {
  const holderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const holder = holderRef.current;
    const box = boxRef.current;
    const view = viewRef.current;
    const source = usePdfStore.getState().sources[page.sourceId];
    if (!holder || !box || !view || !source) return;
    let timer = 0;
    let job = 0;
    let cancelRender: (() => void) | null = null;
    let pdfPage: PDFPageProxy | null = null;
    // Photos are read in full once, the first time they need it; parts are then cut from that.
    let photo: Promise<AnyCanvas> | null = null;

    const show = (canvas: HTMLCanvasElement | null, region?: PageRegion, wide = 1, tall = 1) => {
      const old = holder.firstChild as HTMLCanvasElement | null;
      if (canvas && region) {
        canvas.style.cssText = 'display:block;width:100%;height:100%';
        holder.style.left = `${(region.left / wide) * 100}%`;
        holder.style.top = `${(region.top / tall) * 100}%`;
        holder.style.width = `${(region.width / wide) * 100}%`;
        holder.style.height = `${(region.height / tall) * 100}%`;
        holder.replaceChildren(canvas);
      } else {
        holder.replaceChildren();
      }
      if (old) releaseCanvas(old);
    };

    const draw = async () => {
      const mine = ++job;
      cancelRender?.();
      cancelRender = null;
      const b = box.getBoundingClientRect();
      const v = view.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      if (!b.width || !b.height || b.width * ratio <= previewWidth * STRETCH_LIMIT) {
        show(null);
        return;
      }
      const x0 = clamp01((v.left - v.width * MARGIN - b.left) / b.width);
      const x1 = clamp01((v.right + v.width * MARGIN - b.left) / b.width);
      const y0 = clamp01((v.top - v.height * MARGIN - b.top) / b.height);
      const y1 = clamp01((v.bottom + v.height * MARGIN - b.top) / b.height);
      let wide = b.width * ratio;
      let tall = b.height * ratio;
      const pixels = (x1 - x0) * wide * (y1 - y0) * tall;
      if (pixels > MAX_PIXELS) {
        const shrink = Math.sqrt(MAX_PIXELS / pixels);
        wide *= shrink;
        tall *= shrink;
      }
      const left = Math.floor(x0 * wide);
      const top = Math.floor(y0 * tall);
      const region = { left, top, width: Math.ceil(x1 * wide) - left, height: Math.ceil(y1 * tall) - top };
      if (region.width <= 0 || region.height <= 0) return;

      try {
        if (source.kind === 'pdf') {
          pdfPage ??= await getOpenPdf(source.id).view.getPage(page.index + 1);
          if (mine !== job) return;
          const render = renderPdfRegion(pdfPage, page.rotation, wide, region);
          cancelRender = render.cancel;
          try {
            await render.done;
          } catch (e) {
            releaseCanvas(render.canvas);
            throw e;
          }
          if (mine === job) show(render.canvas, region, wide, tall);
          else releaseCanvas(render.canvas);
          return;
        }
        photo ??= renderPage(page, source, 1, page.rotation, '#ffffff', page.scan);
        const full = await photo;
        if (mine !== job) return;
        if (full.width <= previewWidth * STRETCH_LIMIT) {
          show(null);
          return;
        }
        // On the page, so a DOM canvas rather than an offscreen one.
        const canvas = document.createElement('canvas');
        canvas.width = region.width;
        canvas.height = region.height;
        const sx = full.width / wide;
        const sy = full.height / tall;
        getContext(canvas).drawImage(full, left * sx, top * sy, region.width * sx, region.height * sy, 0, 0, region.width, region.height);
        show(canvas, region, wide, tall);
      } catch {
        // A cancelled or failed redraw leaves the page picture showing, which is still correct.
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(), SETTLE_MS);
    };
    // Every zoom changes the page's size, whichever way it was done; this also runs once at the start.
    const observer = new ResizeObserver(schedule);
    observer.observe(box);
    view.addEventListener('scroll', schedule, { passive: true });

    return () => {
      job++;
      window.clearTimeout(timer);
      observer.disconnect();
      view.removeEventListener('scroll', schedule);
      cancelRender?.();
      show(null);
      void photo?.then(releaseCanvas, () => undefined);
      pdfPage?.cleanup();
    };
  }, [page, previewWidth, boxRef, viewRef]);

  return <div ref={holderRef} aria-hidden className="pointer-events-none absolute" />;
}
