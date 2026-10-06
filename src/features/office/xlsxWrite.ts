import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * Writes Excel workbooks (.xlsx): cells with text or numbers, bold text, number formats (so numbers
 * stay numbers that can be summed and sorted) and column widths. A minimal, valid package that
 * Excel, Google Sheets, Numbers and LibreOffice open.
 */

export interface OutCell {
  value: string | number;
  bold?: boolean;
  /** Excel format code for numbers, such as "#,##0.00" or "0.0%". */
  format?: string;
}

export interface OutSheet {
  name: string;
  rows: (OutCell | null)[][];
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sheet names: at most 31 characters, none of []:*?/\, and unique in the workbook. */
function sheetNames(sheets: OutSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = (s.name.replace(/[[\]:*?/\\]/g, ' ').trim() || `Sheet${i + 1}`).slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function writeXlsx(sheets: OutSheet[], title = ''): Blob {
  const files: Zippable = {};
  const put = (path: string, text: string) => (files[path] = strToU8(text));

  // Shared strings and styles, collected while the sheets are written.
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const formats: string[] = [];
  const xfs: { bold: boolean; fmt: number }[] = [{ bold: false, fmt: 0 }];
  const xfIndex = new Map<string, number>([['0:0', 0]]);
  const styleOf = (cell: OutCell): number => {
    let fmt = 0;
    if (cell.format && typeof cell.value === 'number') {
      let i = formats.indexOf(cell.format);
      if (i < 0) i = formats.push(cell.format) - 1;
      fmt = 164 + i;
    }
    const key = `${cell.bold ? 1 : 0}:${fmt}`;
    let x = xfIndex.get(key);
    if (x === undefined) {
      x = xfs.push({ bold: !!cell.bold, fmt }) - 1;
      xfIndex.set(key, x);
    }
    return x;
  };

  const names = sheetNames(sheets);
  sheets.forEach((sheet, si) => {
    const widths: number[] = [];
    const rowsXml = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((cell, c) => {
            if (!cell || cell.value === '') return '';
            const ref = `${colName(c)}${r + 1}`;
            const s = styleOf(cell);
            const text = typeof cell.value === 'number' ? String(cell.value) : cell.value;
            widths[c] = Math.max(widths[c] ?? 0, Math.min(60, text.length * (cell.bold ? 1.15 : 1.05) + 2));
            if (typeof cell.value === 'number') return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${cell.value}</v></c>`;
            let si2 = stringIndex.get(cell.value);
            if (si2 === undefined) {
              si2 = strings.push(cell.value) - 1;
              stringIndex.set(cell.value, si2);
            }
            return `<c r="${ref}" t="s"${s ? ` s="${s}"` : ''}><v>${si2}</v></c>`;
          })
          .join('');
        return cells ? `<row r="${r + 1}">${cells}</row>` : '';
      })
      .join('');
    const cols = widths.length
      ? `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.max(8.43, w ?? 8.43).toFixed(2)}" customWidth="1"/>`).join('')}</cols>`
      : '';
    put(`xl/worksheets/sheet${si + 1}.xml`, `${XML}<worksheet xmlns="${NS}" xmlns:r="${REL}"><sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ''}/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`);
  });

  put(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  );
  put(
    '_rels/.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  put(
    'docProps/core.xml',
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>ofctools</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  put('docProps/app.xml', `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ofctools</Application></Properties>`);
  put(
    'xl/workbook.xml',
    `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${names
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );
  put(
    'xl/_rels/workbook.xml.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  );
  put(
    'xl/styles.xml',
    `${XML}<styleSheet xmlns="${NS}">${formats.length ? `<numFmts count="${formats.length}">${formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''}<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs
      .map((x) => `<xf numFmtId="${x.fmt}" fontId="${x.bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"${x.fmt ? ' applyNumberFormat="1"' : ''}${x.bold ? ' applyFont="1"' : ''}/>`)
      .join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  put('xl/sharedStrings.xml', `${XML}<sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`);

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
