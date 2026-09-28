/**
 * Every tool's name, address and search-engine text. Plain data with no browser or React imports,
 * because the build reads it too: vite.config.ts writes one HTML page per tool from this list, so
 * each address has its own title and description before any script runs.
 */

export type ToolId =
  | 'compress'
  | 'convert'
  | 'resize'
  | 'background'
  | 'trim'
  | 'clean'
  | 'pdf'
  | 'edit-pdf'
  | 'merge'
  | 'docx-to-pdf'
  | 'pdf-to-docx'
  | 'edit-docx'
  | 'text-to-pdf'
  | 'rtf-to-pdf'
  | 'html-to-pdf'
  | 'pdf-to-text'
  | 'pdf-to-html'
  | 'pdf-to-pptx'
  | 'excel-to-pdf'
  | 'pdf-to-xlsx'
  | 'pptx-to-pdf';

/** Kinds of file a tool works on, shown as labels on its card. */
export type FileKind = 'image' | 'video' | 'pdf' | 'word' | 'document' | 'sheet' | 'slides';

export interface ToolInfo {
  id: ToolId;
  /** Address without the site's base path, e.g. "/compress". */
  path: string;
  /** Short name for menus and cards. */
  name: string;
  /** Page heading. */
  heading: string;
  /** One line under the name on cards. */
  tagline: string;
  /** Intro under the page heading, also the meta description. */
  description: string;
  /** Browser tab and search result title. */
  title: string;
  handles: FileKind[];
  /** Formats listed on the card. */
  formats: string;
  /** Listed under "Convert to PDF" or "Convert from PDF". */
  converts?: 'to-pdf' | 'from-pdf';
  /** What a "from PDF" converter produces, shown in the converter lists. */
  output?: string;
  /**
   * Single-format converters: listed with the converters rather than as cards in the main grid
   * and menu, which would otherwise run to dozens of near-identical entries.
   */
  secondary?: true;
}

export const SITE_NAME = 'CompressKit';

export const HOME_META = {
  title: 'CompressKit: Private File Tools That Run in Your Browser',
  description:
    'Compress, convert, resize and trim photos and videos, remove backgrounds and hidden location data, edit PDFs and Word documents, and convert Word, Excel, PowerPoint, text and HTML to and from PDF. Everything runs in your browser. No uploads, no account.',
};

export const CATALOG: ToolInfo[] = [
  {
    id: 'compress',
    path: '/compress',
    name: 'Compress',
    heading: 'Compress images and videos',
    tagline: 'Make photos and videos smaller without visible quality loss.',
    description:
      'Shrink JPG, PNG, WebP and AVIF images and MP4, MOV, WebM and MKV videos in your browser, with presets, a target file size and before/after comparison. No uploads.',
    title: 'Compress Images and Videos Online, Privately | CompressKit',
    handles: ['image', 'video'],
    formats: 'JPG · PNG · WebP · AVIF · MP4 · MOV · WebM · MKV',
  },
  {
    id: 'convert',
    path: '/convert',
    name: 'Convert',
    heading: 'Convert images and videos',
    tagline: 'HEIC to JPG, PNG to WebP, video to MP4, GIF or MP3.',
    description:
      'Convert photos to JPG, PNG, WebP or AVIF (including iPhone HEIC) and videos to MP4, WebM, animated GIF or audio, right in your browser. No uploads.',
    title: 'Convert HEIC, PNG, WebP, Video to MP4, GIF or MP3 | CompressKit',
    handles: ['image', 'video'],
    formats: 'HEIC · JPG · PNG · WebP · AVIF · MP4 · GIF · MP3',
  },
  {
    id: 'resize',
    path: '/resize',
    name: 'Resize & crop',
    heading: 'Resize and crop photos',
    tagline: 'Passport photos, signatures, profile pictures and posts at exact sizes.',
    description:
      'Crop and resize photos to exact pixel sizes for passport and visa photos, signatures, profile pictures, Instagram posts and YouTube thumbnails, with an optional KB limit.',
    title: 'Resize and Crop Photos to Exact Sizes, Free | CompressKit',
    handles: ['image'],
    formats: 'JPG · PNG · WebP · AVIF · BMP',
  },
  {
    id: 'background',
    path: '/remove-background',
    name: 'Remove background',
    heading: 'Remove the background from a photo',
    tagline: 'Cut out people, pets and products with AI on your device.',
    description:
      'Remove photo backgrounds with an AI model that runs in your browser. Get a transparent PNG or put the subject on any colour. Your photos are never uploaded.',
    title: 'Remove Background from Photos, Free and Private | CompressKit',
    handles: ['image'],
    formats: 'JPG · PNG · WebP · AVIF · BMP',
  },
  {
    id: 'trim',
    path: '/trim-video',
    name: 'Trim & split video',
    heading: 'Trim and split videos',
    tagline: 'Cut a clip, or split a video into WhatsApp Status parts.',
    description:
      'Trim a video to the part you want, or split it into 60-second parts for WhatsApp Status, without re-encoding and without uploading it.',
    title: 'Trim Video and Split for WhatsApp Status, Online | CompressKit',
    handles: ['video'],
    formats: 'MP4 · MOV · WebM · MKV',
  },
  {
    id: 'clean',
    path: '/remove-location',
    name: 'Remove location',
    heading: 'Remove hidden location from photos and videos',
    tagline: 'Strip GPS, camera and date details before you share.',
    description:
      'See and remove the hidden GPS location, camera, date and other details inside photos and videos before you share them. Nothing is re-encoded and nothing is uploaded.',
    title: 'Remove Location and EXIF Data from Photos and Videos | CompressKit',
    handles: ['image', 'video'],
    formats: 'JPG · PNG · HEIC · WebP · AVIF · MP4 · MOV',
  },
  {
    id: 'pdf',
    path: '/pdf',
    name: 'PDF tools',
    heading: 'PDF tools',
    tagline: 'Photos to PDF, merge, split, sign, compress, OCR and more.',
    description:
      'Turn photos into a PDF, merge, split, crop and reorder pages, sign, fill forms, compress, protect with a password or make scans searchable. All in your browser.',
    title: 'Free PDF Tools: Merge, Split, Sign, Compress, OCR | CompressKit',
    handles: ['pdf', 'image', 'word'],
    formats: 'PDF · DOCX · JPG · PNG · HEIC · TIFF · GIF',
  },
  {
    id: 'edit-pdf',
    path: '/edit-pdf',
    name: 'Edit PDF',
    heading: 'Edit a PDF',
    tagline: 'Change text, add text and pictures, white out, highlight and draw.',
    description:
      'Edit PDF files in your browser: change existing text, add text boxes and pictures, white out, highlight, draw and add shapes. Your PDF is never uploaded.',
    title: 'Edit PDF Online: Change Text, Add Text and Images, Free | CompressKit',
    handles: ['pdf', 'image'],
    formats: 'PDF · JPG · PNG',
  },
  {
    id: 'merge',
    path: '/merge-documents',
    name: 'Merge documents',
    heading: 'Merge PDFs, Word files and photos',
    tagline: 'Combine PDFs, Word documents and photos into one file.',
    description:
      'Merge PDF files, Word documents (DOCX), photos and scans (JPG, PNG, HEIC, TIFF, GIF) into one PDF, in the order you choose, or join Word files into one DOCX. Nothing is uploaded.',
    title: 'Merge PDF and Word Documents into One File, Free | CompressKit',
    handles: ['pdf', 'word', 'image'],
    formats: 'PDF · DOCX · JPG · PNG · HEIC · TIFF',
  },
  {
    id: 'docx-to-pdf',
    path: '/docx-to-pdf',
    name: 'Word to PDF',
    heading: 'Convert Word to PDF',
    tagline: 'Turn DOCX files into PDFs with selectable text.',
    description:
      'Convert Word documents (DOCX) to PDF in your browser, with headings, lists, tables and pictures, and text that stays selectable. Your documents are never uploaded.',
    title: 'Word to PDF Converter: DOCX to PDF, Free and Private | CompressKit',
    handles: ['word'],
    formats: 'DOCX',
    converts: 'to-pdf',
  },
  {
    id: 'pdf-to-docx',
    path: '/pdf-to-docx',
    name: 'PDF to Word',
    heading: 'Convert PDF to Word',
    tagline: 'Turn PDFs into editable DOCX files, scans included.',
    description:
      'Convert PDF files to editable Word documents (DOCX) with headings, lists and pictures. Scanned pages can be read with OCR. All in your browser, nothing uploaded.',
    title: 'PDF to Word Converter: PDF to DOCX, Free and Private | CompressKit',
    handles: ['pdf'],
    formats: 'PDF',
    converts: 'from-pdf',
    output: 'DOCX',
  },
  {
    id: 'edit-docx',
    path: '/edit-docx',
    name: 'Edit Word document',
    heading: 'Edit a Word document',
    tagline: 'Open, edit and save DOCX files, or start a new one.',
    description:
      'Open and edit Word documents (DOCX) in your browser: text, headings, lists, tables and pictures. Save as DOCX or PDF. No account, no upload, no Office needed.',
    title: 'Edit Word Documents Online: Free DOCX Editor | CompressKit',
    handles: ['word', 'pdf'],
    formats: 'DOCX · PDF',
  },
  {
    id: 'text-to-pdf',
    path: '/text-to-pdf',
    name: 'Text to PDF',
    heading: 'Convert text files to PDF',
    tagline: 'Turn TXT and Markdown files into clean, searchable PDFs.',
    description:
      'Convert plain text (.txt) and Markdown (.md) files to PDF in your browser. Lines, indentation and columns stay exactly as typed; Markdown becomes formatted headings, lists and tables.',
    title: 'Text to PDF Converter: TXT and Markdown to PDF, Free | CompressKit',
    handles: ['document'],
    formats: 'TXT · MD',
    converts: 'to-pdf',
    secondary: true,
  },
  {
    id: 'rtf-to-pdf',
    path: '/rtf-to-pdf',
    name: 'RTF to PDF',
    heading: 'Convert RTF to PDF',
    tagline: 'Rich Text from WordPad, TextEdit or Word, as a PDF.',
    description:
      'Convert Rich Text Format (.rtf) documents to PDF in your browser, with fonts, colours, headings, lists, tables, links and pictures. Text stays selectable. Nothing is uploaded.',
    title: 'RTF to PDF Converter: Free and Private | CompressKit',
    handles: ['document'],
    formats: 'RTF',
    converts: 'to-pdf',
    secondary: true,
  },
  {
    id: 'html-to-pdf',
    path: '/html-to-pdf',
    name: 'HTML to PDF',
    heading: 'Convert HTML to PDF',
    tagline: 'Saved web pages and HTML files, as PDFs.',
    description:
      'Convert HTML files to PDF in your browser, with their styles, tables, lists, links and embedded pictures. Scripts never run and nothing is fetched or uploaded.',
    title: 'HTML to PDF Converter: HTML Files to PDF, Free | CompressKit',
    handles: ['document'],
    formats: 'HTML · HTM',
    converts: 'to-pdf',
    secondary: true,
  },
  {
    id: 'pdf-to-text',
    path: '/pdf-to-text',
    name: 'PDF to Text',
    heading: 'Convert PDF to text',
    tagline: 'Get the text out of a PDF, scans included.',
    description:
      'Extract the text from PDF files as a plain .txt file, in reading order or with the page layout kept. Scanned pages are read with OCR. All in your browser, nothing uploaded.',
    title: 'PDF to Text Converter: Extract Text from PDF, Free | CompressKit',
    handles: ['pdf'],
    formats: 'PDF',
    converts: 'from-pdf',
    output: 'TXT',
    secondary: true,
  },
  {
    id: 'pdf-to-html',
    path: '/pdf-to-html',
    name: 'PDF to HTML',
    heading: 'Convert PDF to HTML',
    tagline: 'Turn a PDF into a clean web page.',
    description:
      'Convert PDF files into a single, self-contained HTML page with real headings, paragraphs, lists, tables, links and pictures that reflows on any screen. Nothing is uploaded.',
    title: 'PDF to HTML Converter: Free and Private | CompressKit',
    handles: ['pdf'],
    formats: 'PDF',
    converts: 'from-pdf',
    output: 'HTML',
    secondary: true,
  },
  {
    id: 'pdf-to-pptx',
    path: '/pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    heading: 'Convert PDF to PowerPoint',
    tagline: 'Turn PDF pages into slides with editable text.',
    description:
      'Convert PDF files to PowerPoint (PPTX) in your browser. Each page becomes a slide with its text as editable text boxes, and pictures and backgrounds kept exactly. Nothing is uploaded.',
    title: 'PDF to PowerPoint Converter: PDF to PPTX, Free | CompressKit',
    handles: ['pdf'],
    formats: 'PDF',
    converts: 'from-pdf',
    output: 'PPTX',
    secondary: true,
  },
  {
    id: 'excel-to-pdf',
    path: '/excel-to-pdf',
    name: 'Excel to PDF',
    heading: 'Convert Excel to PDF',
    tagline: 'Print spreadsheets to PDF with their formatting.',
    description:
      'Convert Excel workbooks (XLSX) and CSV files to PDF in your browser, with fonts, colours, borders, merged cells, dates and currency formats, fitted to the page. Nothing is uploaded.',
    title: 'Excel to PDF Converter: XLSX and CSV to PDF, Free | CompressKit',
    handles: ['sheet'],
    formats: 'XLSX · CSV',
    converts: 'to-pdf',
    secondary: true,
  },
  {
    id: 'pdf-to-xlsx',
    path: '/pdf-to-excel',
    name: 'PDF to Excel',
    heading: 'Convert PDF to Excel',
    tagline: 'Pull tables out of PDFs into spreadsheet rows and columns.',
    description:
      'Convert PDF tables to Excel (XLSX) in your browser. Rows and columns are rebuilt, and amounts, percentages and dates become numbers you can sum. Scans are read with OCR. Nothing is uploaded.',
    title: 'PDF to Excel Converter: PDF Tables to XLSX, Free | CompressKit',
    handles: ['pdf', 'sheet'],
    formats: 'PDF',
    converts: 'from-pdf',
    output: 'XLSX',
    secondary: true,
  },
  {
    id: 'pptx-to-pdf',
    path: '/powerpoint-to-pdf',
    name: 'PowerPoint to PDF',
    heading: 'Convert PowerPoint to PDF',
    tagline: 'Slides to PDF pages, with their design kept.',
    description:
      'Convert PowerPoint presentations (PPTX) to PDF in your browser, with backgrounds, shapes, pictures, tables and text from the slide layouts and theme. Nothing is uploaded.',
    title: 'PowerPoint to PDF Converter: PPTX to PDF, Free | CompressKit',
    handles: ['slides'],
    formats: 'PPTX',
    converts: 'to-pdf',
    secondary: true,
  },
];

export const TOOL_BY_ID = Object.fromEntries(CATALOG.map((t) => [t.id, t])) as Record<ToolId, ToolInfo>;

/**
 * Hash links from before tools had their own pages ("#convert"), mapped to the new addresses so
 * shared links keep working.
 */
export const LEGACY_HASHES: Record<string, string> = {
  '#compress': '/compress',
  '#convert': '/convert',
  '#resize': '/resize',
  '#trim': '/trim-video',
  '#clean': '/remove-location',
  '#remove-background': '/remove-background',
  '#pdf': '/pdf',
};
