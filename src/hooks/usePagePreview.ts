import { useEffect, useState } from 'react';
import { canvasToBlob, releaseCanvas } from '../features/image/canvas';
import { decodeImage } from '../features/image/decode';
import { getOpenPdf } from '../features/pdf/documents';
import { renderPage } from '../features/pdf/render';
import { usePdfStore } from '../store/pdfStore';
import type { PdfPage } from '../types/pdf';

/** Long side of the page preview, in pixels. */
const PREVIEW_SIDE = 1100;

/** The page as displayed (with the user's rotation), as an object URL and its size. */
export function usePagePreview(page: PdfPage) {
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void (async () => {
      const source = usePdfStore.getState().sources[page.sourceId];
      if (!source) return;
      // renderPage scales PDF pages per point and photos per pixel, so size each from its own dimensions.
      let longSide: number;
      if (source.kind === 'pdf') {
        const viewport = (await getOpenPdf(source.id).view.getPage(page.index + 1)).getViewport({ scale: 1 });
        longSide = Math.max(viewport.width, viewport.height);
      } else {
        const bitmap = await decodeImage(source.file);
        longSide = Math.max(bitmap.width, bitmap.height);
        bitmap.close();
      }
      const canvas = await renderPage(page, source, Math.min(4, PREVIEW_SIDE / longSide), page.rotation, '#ffffff', page.scan);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
      const size = { width: canvas.width, height: canvas.height };
      releaseCanvas(canvas);
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setPreview({ url, ...size });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [page]);
  return preview;
}
