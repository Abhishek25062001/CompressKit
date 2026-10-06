import { strToU8, zipSync, type Zippable } from 'fflate';

/**
 * Writes a PowerPoint (.pptx) file: a complete, minimal OOXML package (theme, slide master, one
 * blank layout, and the slides) that PowerPoint, Keynote, Google Slides and LibreOffice all open.
 * Slides hold pictures and text boxes placed in points; everything is converted to EMUs here.
 */

export interface SlideRun {
  text: string;
  /** Points. */
  size: number;
  bold?: boolean;
  italic?: boolean;
  /** "rrggbb". */
  color?: string;
  font?: string;
}

export interface SlideTextBox {
  /** Position and size in points from the slide's top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Each line is a paragraph of runs, kept exactly (no re-wrapping). */
  lines: SlideRun[][];
  /** Distance between baselines, in points. */
  lineSpacing?: number;
  /** Clockwise rotation around the box's centre, in degrees. */
  rotation?: number;
}

export interface SlidePicture {
  x: number;
  y: number;
  width: number;
  height: number;
  data: Uint8Array;
  mime: 'image/jpeg' | 'image/png';
}

export interface Slide {
  pictures: SlidePicture[];
  texts: SlideTextBox[];
}

const EMU = 12700;
const emu = (pt: number) => Math.round(pt * EMU);

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 does not allow.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function rels(items: { id: string; type: string; target: string }[]): string {
  return `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${r.target}"/>`)
    .join('')}</Relationships>`;
}

const THEME = `${XML}<a:theme xmlns:a="${NS_A}" name="Office Theme"><a:themeElements>
<a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const EMPTY_TREE = `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const MASTER = `${XML}<p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT = `${XML}<p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${EMPTY_TREE}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

function runXml(r: SlideRun): string {
  const font = r.font ? `<a:latin typeface="${esc(r.font)}"/><a:cs typeface="${esc(r.font)}"/>` : '';
  const fill = `<a:solidFill><a:srgbClr val="${(r.color ?? '000000').toUpperCase()}"/></a:solidFill>`;
  const size = Math.max(100, Math.min(400000, Math.round(r.size * 100)));
  return `<a:r><a:rPr lang="en-US" sz="${size}"${r.bold ? ' b="1"' : ''}${r.italic ? ' i="1"' : ''} dirty="0">${fill}${font}</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`;
}

function textBoxXml(box: SlideTextBox, id: number): string {
  const spacing = box.lineSpacing ? `<a:lnSpc><a:spcPts val="${Math.round(box.lineSpacing * 100)}"/></a:lnSpc>` : '';
  const paras = box.lines
    .map((runs) => {
      const endSize = Math.round((runs[runs.length - 1]?.size ?? 12) * 100);
      return `<a:p><a:pPr>${spacing}<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${runs.map(runXml).join('')}<a:endParaRPr lang="en-US" sz="${endSize}" dirty="0"/></a:p>`;
    })
    .join('');
  const rot = box.rotation ? Math.round((((box.rotation % 360) + 360) % 360) * 60000) : 0;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${rot ? ` rot="${rot}"` : ''}><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${Math.max(1, emu(box.width))}" cy="${Math.max(1, emu(box.height))}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}

function pictureXml(pic: SlidePicture, id: number, rid: string): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${emu(pic.x)}" y="${emu(pic.y)}"/><a:ext cx="${Math.max(1, emu(pic.width))}" cy="${Math.max(1, emu(pic.height))}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** Builds the .pptx. `width` and `height` are the slide size in points. */
export function writePptx(slides: Slide[], width: number, height: number, title = ''): Blob {
  // PowerPoint accepts slides from 1 to 56 inches on a side.
  const cx = Math.min(51206400, Math.max(914400, emu(width)));
  const cy = Math.min(51206400, Math.max(914400, emu(height)));
  const files: Zippable = {};
  const put = (path: string, text: string) => (files[path] = strToU8(text));

  let media = 0;
  const hasJpeg = slides.some((s) => s.pictures.some((p) => p.mime === 'image/jpeg'));
  const hasPng = slides.some((s) => s.pictures.some((p) => p.mime === 'image/png'));
  const slideOverrides = slides
    .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join('');
  put(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasJpeg ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : ''}${hasPng ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slideOverrides}</Types>`,
  );
  put(
    '_rels/.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  put(
    'docProps/core.xml',
    `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>ofctools</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
  );
  put(
    'docProps/app.xml',
    `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ofctools</Application><Slides>${slides.length}</Slides><PresentationFormat>Custom</PresentationFormat></Properties>`,
  );
  put(
    'ppt/presentation.xml',
    `${XML}<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
      .join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`,
  );
  const n = slides.length;
  put(
    'ppt/_rels/presentation.xml.rels',
    rels([
      { id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' },
      ...slides.map((_, i) => ({ id: `rId${i + 2}`, type: 'slide', target: `slides/slide${i + 1}.xml` })),
      { id: `rId${n + 2}`, type: 'presProps', target: 'presProps.xml' },
      { id: `rId${n + 3}`, type: 'viewProps', target: 'viewProps.xml' },
      { id: `rId${n + 4}`, type: 'theme', target: 'theme/theme1.xml' },
      { id: `rId${n + 5}`, type: 'tableStyles', target: 'tableStyles.xml' },
    ]),
  );
  put('ppt/presProps.xml', `${XML}<p:presentationPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"/>`);
  put(
    'ppt/viewProps.xml',
    `${XML}<p:viewPr xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`,
  );
  put('ppt/tableStyles.xml', `${XML}<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  put('ppt/theme/theme1.xml', THEME);
  put('ppt/slideMasters/slideMaster1.xml', MASTER);
  put(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      { id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' },
    ]),
  );
  put('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));

  slides.forEach((slide, i) => {
    const slideRels = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    let shapeId = 2;
    let body = '';
    for (const pic of slide.pictures) {
      media++;
      const ext = pic.mime === 'image/png' ? 'png' : 'jpeg';
      const name = `image${media}.${ext}`;
      files[`ppt/media/${name}`] = [pic.data, { level: 0 }];
      const rid = `rId${slideRels.length + 1}`;
      slideRels.push({ id: rid, type: 'image', target: `../media/${name}` });
      body += pictureXml(pic, shapeId++, rid);
    }
    for (const box of slide.texts) body += textBoxXml(box, shapeId++);
    put(
      `ppt/slides/slide${i + 1}.xml`,
      `${XML}<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree>${EMPTY_TREE}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`,
    );
    put(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(slideRels));
  });

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
}
