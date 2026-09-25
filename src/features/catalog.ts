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
  | 'edit-docx';

/** Kinds of file a tool works on, shown as labels on its card. */
export type FileKind = 'image' | 'video' | 'pdf' | 'word';

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
}

export const SITE_NAME = 'CompressKit';

export const HOME_META = {
  title: 'CompressKit: Private File Tools That Run in Your Browser',
  description:
    'Compress, convert, resize and trim photos and videos, remove backgrounds and hidden location data, edit PDFs and Word documents, and convert between them. Everything runs in your browser. No uploads, no account.',
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
      'Turn photos into a PDF, merge, split and reorder pages, sign, fill forms, compress, protect with a password or make scans searchable. All in your browser.',
    title: 'Free PDF Tools: Merge, Split, Sign, Compress, OCR | CompressKit',
    handles: ['pdf', 'image', 'word'],
    formats: 'PDF · DOCX · JPG · PNG · HEIC · WebP',
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
      'Merge PDF files, Word documents (DOCX) and photos into one PDF, in the order you choose, or join Word files into one DOCX. Nothing is uploaded.',
    title: 'Merge PDF and Word Documents into One File, Free | CompressKit',
    handles: ['pdf', 'word', 'image'],
    formats: 'PDF · DOCX · JPG · PNG · HEIC',
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
