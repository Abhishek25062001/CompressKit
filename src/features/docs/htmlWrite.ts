import { createImageStore, docToHtml, releaseImages } from './html';
import type { DocModel } from './model';

/**
 * Writes the document model as a standalone web page: semantic HTML (headings, paragraphs, lists,
 * tables, links) with a small stylesheet, and pictures embedded as data, so the single .html file
 * opens anywhere, offline, and can be edited in any HTML or text editor.
 */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

const STYLES = `
:root { color-scheme: light; }
body { margin: 0; background: #f3f4f6; color: #111827; font: 11pt/1.5 Arial, Helvetica, sans-serif; }
main { box-sizing: border-box; max-width: 820px; margin: 32px auto; padding: 56px 64px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
h1 { font-size: 26pt; line-height: 1.2; margin: 0 0 12pt; }
h2 { font-size: 18pt; line-height: 1.25; margin: 16pt 0 8pt; }
h3 { font-size: 14pt; line-height: 1.3; margin: 12pt 0 6pt; }
h4 { font-size: 12pt; margin: 10pt 0 4pt; }
p { margin: 0 0 8pt; }
blockquote { margin: 6pt 0 10pt; padding-left: 12pt; border-left: 3px solid #c7c7cc; color: #404040; font-style: italic; }
ul, ol { margin: 0 0 8pt; padding-left: 24pt; }
li { margin: 0 0 3pt; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; }
td, th { border: 1px solid #9ca3af; padding: 4pt 6pt; vertical-align: top; }
td p, th p { margin: 0; }
img { max-width: 100%; height: auto !important; vertical-align: middle; }
a { color: #0563c1; }
.doc-tab { white-space: pre; tab-size: 4; }
hr.page-break { border: 0; border-top: 1px dashed #d1d5db; margin: 28pt -64px; }
@media (max-width: 700px) { main { margin: 0; padding: 24px 18px; box-shadow: none; } hr.page-break { margin: 20pt -18px; } }
@media print {
  body { background: #fff; }
  main { max-width: none; margin: 0; padding: 0; box-shadow: none; }
  hr.page-break { border: 0; margin: 0; break-after: page; }
}
`.trim();

export function docToHtmlFile(doc: DocModel, title: string): string {
  const store = createImageStore();
  try {
    let body = docToHtml(doc, store);
    // Pictures: the editor's blob addresses become data embedded in the file.
    body = body.replace(/<img data-img="([^"]+)" src="[^"]*"/g, (_, id: string) => {
      const img = store.images.get(id);
      return img ? `<img src="data:${img.mime};base64,${base64(img.data)}"` : '<img alt=""';
    });
    body = body.replace(/<hr class="doc-page-break"[^>]*>/g, '<hr class="page-break">');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CompressKit">
<title>${escapeHtml(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
  } finally {
    releaseImages(store);
  }
}
