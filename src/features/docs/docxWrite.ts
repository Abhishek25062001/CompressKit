import { strToU8, zipSync } from 'fflate';
import type { Block, DocModel, FontFamily, ImageRun, Paragraph, ParagraphStyle, Run, Table, TextRun } from './model';

/** Writes the shared document model as a Word document (.docx) that Word, Pages and Google Docs open. */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const FONT_NAME: Record<FontFamily, string> = { sans: 'Calibri', serif: 'Times New Roman', mono: 'Courier New' };
const STYLE_ID: Record<ParagraphStyle, string | null> = {
  normal: null,
  title: 'Title',
  h1: 'Heading1',
  h2: 'Heading2',
  h3: 'Heading3',
  quote: 'Quote',
};

// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
const esc = (s: string) =>
  s.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const twips = (pt: number) => Math.round(pt * 20);
const EMU_PER_POINT = 12700;

interface Context {
  rels: string[];
  media: Record<string, Uint8Array>;
  /** One numbering instance per ordered list, so each list starts at 1. */
  nums: { id: number; ordered: boolean }[];
  imageCount: number;
  linkIds: Map<string, string>;
}

function relId(ctx: Context): string {
  return `rId${ctx.rels.length + 10}`;
}

function runProps(r: TextRun): string {
  const p: string[] = [];
  if (r.link) p.push('<w:rStyle w:val="Hyperlink"/>');
  if (r.font) p.push(`<w:rFonts w:ascii="${FONT_NAME[r.font]}" w:hAnsi="${FONT_NAME[r.font]}" w:cs="${FONT_NAME[r.font]}"/>`);
  if (r.bold) p.push('<w:b/><w:bCs/>');
  if (r.italic) p.push('<w:i/><w:iCs/>');
  if (r.strike) p.push('<w:strike/>');
  if (r.color) p.push(`<w:color w:val="${r.color.slice(1).toUpperCase()}"/>`);
  if (r.size) p.push(`<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>`);
  if (r.highlight) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${r.highlight.slice(1).toUpperCase()}"/>`);
  if (r.underline) p.push('<w:u w:val="single"/>');
  return p.length ? `<w:rPr>${p.join('')}</w:rPr>` : '';
}

function textRun(r: TextRun): string {
  const props = runProps(r);
  // Tabs are their own element; everything between them is a text node that keeps its spaces.
  return r.text
    .split('\t')
    .map((part, i) => `${i ? `<w:r>${props}<w:tab/></w:r>` : ''}${part ? `<w:r>${props}<w:t xml:space="preserve">${esc(part)}</w:t></w:r>` : ''}`)
    .join('');
}

function imageXml(image: ImageRun, ctx: Context): string {
  const n = ++ctx.imageCount;
  const ext = image.mime === 'image/png' ? 'png' : 'jpeg';
  const name = `image${n}.${ext}`;
  ctx.media[`word/media/${name}`] = image.data;
  const id = relId(ctx);
  ctx.rels.push(
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
  );
  const cx = Math.round(image.width * EMU_PER_POINT);
  const cy = Math.round(image.height * EMU_PER_POINT);
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function runsXml(runs: Run[], ctx: Context): string {
  let out = '';
  let i = 0;
  while (i < runs.length) {
    const r = runs[i];
    if (r.type === 'break') {
      out += '<w:r><w:br/></w:r>';
      i++;
    } else if (r.type === 'image') {
      out += imageXml(r, ctx);
      i++;
    } else if (r.link) {
      // Neighbouring runs with the same link share one hyperlink element.
      const link = r.link;
      let inner = '';
      while (i < runs.length && runs[i].type === 'text' && (runs[i] as TextRun).link === link) inner += textRun(runs[i++] as TextRun);
      let id = ctx.linkIds.get(link);
      if (!id) {
        id = relId(ctx);
        ctx.linkIds.set(link, id);
        ctx.rels.push(
          `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(link)}" TargetMode="External"/>`,
        );
      }
      out += `<w:hyperlink r:id="${id}">${inner}</w:hyperlink>`;
    } else {
      out += textRun(r);
      i++;
    }
  }
  return out;
}

function paragraphXml(p: Paragraph, ctx: Context, numId: number | null, pageBreakBefore = false): string {
  const props: string[] = [];
  const style = STYLE_ID[p.style] ?? (p.list ? 'ListParagraph' : null);
  if (style) props.push(`<w:pStyle w:val="${style}"/>`);
  if (pageBreakBefore) props.push('<w:pageBreakBefore/>');
  if (p.list && numId !== null) props.push(`<w:numPr><w:ilvl w:val="${p.list.level}"/><w:numId w:val="${numId}"/></w:numPr>`);
  if (p.align !== 'left') props.push(`<w:jc w:val="${p.align === 'justify' ? 'both' : p.align}"/>`);
  return `<w:p>${props.length ? `<w:pPr>${props.join('')}</w:pPr>` : ''}${runsXml(p.runs, ctx)}</w:p>`;
}

function tableXml(t: Table, ctx: Context, contentWidth: number): string {
  const columns = Math.max(1, ...t.rows.map((row) => row.reduce((n, c) => n + (c.span ?? 1), 0)));
  const colWidth = twips(contentWidth / columns);
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${colWidth}"/>`).join('');
  const rows = t.rows
    .map((row) => {
      const cells = row
        .map((cell) => {
          const span = cell.span ?? 1;
          const props = [`<w:tcW w:w="${colWidth * span}" w:type="dxa"/>`];
          if (span > 1) props.push(`<w:gridSpan w:val="${span}"/>`);
          if (cell.shade) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${cell.shade.slice(1).toUpperCase()}"/>`);
          // Every cell needs at least one paragraph.
          const body = cell.paragraphs.length ? cell.paragraphs.map((p) => paragraphXml(p, ctx, listNum(ctx, p))).join('') : '<w:p/>';
          return `<w:tc><w:tcPr>${props.join('')}</w:tcPr>${body}</w:tc>`;
        })
        .join('');
      return `<w:tr>${cells}</w:tr>`;
    })
    .join('');
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>` +
    `<w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
  );
}

/** Numbering for a list paragraph outside the main flow (in a table cell): one shared instance per kind. */
function listNum(ctx: Context, p: Paragraph): number | null {
  if (!p.list) return null;
  const found = ctx.nums.find((n) => n.ordered === p.list!.ordered);
  if (found) return found.id;
  const id = ctx.nums.length + 1;
  ctx.nums.push({ id, ordered: p.list.ordered });
  return id;
}

function bodyXml(blocks: Block[], ctx: Context, contentWidth: number): string {
  let out = '';
  let breakNext = false;
  let currentList: { id: number; ordered: boolean } | null = null;
  for (const b of blocks) {
    if (b.type === 'pagebreak') {
      breakNext = true;
      continue;
    }
    if (b.type === 'paragraph') {
      let numId: number | null = null;
      if (b.list) {
        // A new list starts when a list follows other content or changes between bullets and numbers at the top level.
        if (!currentList || (b.list.level === 0 && currentList.ordered !== b.list.ordered)) {
          currentList = { id: ctx.nums.length + 1, ordered: b.list.ordered };
          ctx.nums.push(currentList);
        }
        numId = currentList.id;
      } else currentList = null;
      out += paragraphXml(b, ctx, numId, breakNext);
    } else {
      currentList = null;
      if (breakNext) out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      out += tableXml(b, ctx, contentWidth);
    }
    breakNext = false;
  }
  return out;
}

const BULLETS = ['•', '◦', '▪', '•', '◦'];

function numberingXml(nums: Context['nums']): string {
  const levels = (ordered: boolean) =>
    Array.from({ length: 5 }, (_, l) => {
      const indent = 720 * (l + 1);
      const fmt = ordered ? ['decimal', 'lowerLetter', 'lowerRoman', 'decimal', 'lowerLetter'][l] : 'bullet';
      const text = ordered ? `%${l + 1}.` : BULLETS[l];
      return (
        `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/>` +
        `<w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`
      );
    }).join('');
  const abstracts = nums
    .map((n) => `<w:abstractNum w:abstractNumId="${n.id}"><w:multiLevelType w:val="hybridMultilevel"/>${levels(n.ordered)}</w:abstractNum>`)
    .join('');
  const instances = nums.map((n) => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.id}"/></w:num>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstracts}${instances}</w:numbering>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

function coreXml(title: string): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `${title ? `<dc:title>${esc(title)}</dc:title>` : ''}<dc:creator>CompressKit</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  );
}

/** Builds the .docx file. */
export function writeDocx(doc: DocModel, title = ''): Blob {
  const ctx: Context = { rels: [], media: {}, nums: [], imageCount: 0, linkIds: new Map() };
  const { page } = doc;
  const contentWidth = page.width - page.margin.left - page.margin.right;
  const body = bodyXml(doc.blocks, ctx, contentWidth);
  const landscape = page.width > page.height ? ' w:orient="landscape"' : '';
  const sect =
    `<w:sectPr><w:pgSz w:w="${twips(page.width)}" w:h="${twips(page.height)}"${landscape}/>` +
    `<w:pgMar w:top="${twips(page.margin.top)}" w:right="${twips(page.margin.right)}" w:bottom="${twips(page.margin.bottom)}" w:left="${twips(page.margin.left)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>${body || '<w:p/>'}${sect}</w:body></w:document>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
    `${ctx.rels.join('')}</Relationships>`;

  const zip = zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(ROOT_RELS),
      'docProps/core.xml': strToU8(coreXml(title)),
      'word/document.xml': strToU8(document),
      'word/styles.xml': strToU8(STYLES_XML),
      'word/numbering.xml': strToU8(numberingXml(ctx.nums)),
      'word/_rels/document.xml.rels': strToU8(rels),
      // Pictures are already compressed; storing them avoids deflating them again.
      ...Object.fromEntries(Object.entries(ctx.media).map(([path, data]) => [path, [data, { level: 0 }] as [Uint8Array, { level: 0 }]])),
    },
    { level: 6 },
  );
  return new Blob([zip as BlobPart], { type: DOCX_MIME });
}
