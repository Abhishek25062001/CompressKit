import {
  AlignLeft,
  BookUser,
  Camera,
  CircleUser,
  ClipboardList,
  Code,
  Combine,
  Crop,
  EyeOff,
  Feather,
  FileImage,
  FileInput,
  FileOutput,
  FilePen,
  FilePlus2,
  FileStack,
  FileText,
  Film,
  FlipHorizontal2,
  Globe,
  IdCard,
  Image,
  ImageDown,
  ImagePlay,
  Images,
  Layers,
  LayoutGrid,
  ListOrdered,
  Lock,
  LockOpen,
  MapPinOff,
  Minimize2,
  MonitorPlay,
  Music,
  // Palette, // Used only by Remove Background, which is switched off for now.
  PanelTop,
  PenLine,
  Pilcrow,
  Presentation,
  Scaling,
  ScanLine,
  ScanText,
  Scissors,
  Sheet,
  Shrink,
  Signature,
  Smartphone,
  Split,
  SquarePen,
  // SquareUser, // Used only by Remove Background, which is switched off for now.
  Stamp,
  VolumeX,
  // WandSparkles, // Used only by Remove Background, which is switched off for now.
  type LucideIcon,
} from 'lucide-react';

/**
 * Every job the site can do, as people would name it ("HEIC to JPG", "Passport photo", "Split
 * PDF"), sorted into categories for the header's tools launcher and the home page. Several jobs
 * are one tool with a setting picked: a hash such as "/convert#gif" opens Convert with animated
 * GIF chosen (see intents.ts, and the PDF shortcuts in pdfTools.ts).
 */

export type CategoryId = 'photos' | 'resize' | 'video' | 'word' | 'pdf' | 'to-pdf' | 'from-pdf';

export interface Category {
  id: CategoryId;
  name: string;
  /** One line under the category name on the home page. */
  description: string;
  icon: LucideIcon;
}

export interface Feature {
  /** Unique, stable key. */
  key: string;
  name: string;
  /** One sentence: what it does, in plain words. */
  description: string;
  /** App path, with a hash when the job is a setting of a larger tool. */
  to: string;
  category: CategoryId;
  icon: LucideIcon;
  /** Other words people search with: formats, synonyms, sites. */
  keywords?: string;
}

/** Media first, then documents; this order also balances the launcher's four columns. */
export const CATEGORIES: Category[] = [
  // Remove Background is switched off for now; with it on: 'Shrink, convert and clean up pictures, and cut out backgrounds.'
  { id: 'photos', name: 'Photos', description: 'Shrink, convert and clean up pictures.', icon: Image },
  { id: 'resize', name: 'Resize & crop', description: 'Exact sizes for IDs, forms and social media, plus crop and rotate.', icon: Crop },
  { id: 'video', name: 'Videos', description: 'Shrink, convert, trim and split videos, or save just the sound.', icon: Film },
  { id: 'word', name: 'Word documents', description: 'Edit, create and join DOCX files without Office.', icon: SquarePen },
  { id: 'pdf', name: 'PDF tools', description: 'Merge, split, compress, edit, sign and secure PDFs.', icon: FileStack },
  { id: 'to-pdf', name: 'Convert to PDF', description: 'Photos, Word, Excel, PowerPoint and more, as PDFs.', icon: FileInput },
  { id: 'from-pdf', name: 'Convert from PDF', description: 'Turn PDFs back into editable files or pictures.', icon: FileOutput },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, Category>;

export const FEATURES: Feature[] = [
  // Photos
  {
    key: 'compress-images',
    name: 'Compress images',
    description: 'Make JPG, PNG, WebP and AVIF photos smaller, or fit them under a KB limit.',
    to: '/compress',
    category: 'photos',
    icon: Shrink,
    keywords: 'reduce size shrink optimize photo picture kb mb jpeg',
  },
  {
    key: 'heic-to-jpg',
    name: 'HEIC to JPG',
    description: 'Turn iPhone photos, PNG or WebP into JPGs that open anywhere.',
    to: '/convert#jpg',
    category: 'photos',
    icon: ImageDown,
    keywords: 'convert iphone heif jpeg png to jpg webp to jpg avif to jpg image',
  },
  {
    key: 'image-to-png',
    name: 'Convert to PNG',
    description: 'Lossless PNG copies of any photo, HEIC included.',
    to: '/convert#png',
    category: 'photos',
    icon: FileImage,
    keywords: 'jpg to png heic to png webp to png image convert',
  },
  {
    key: 'image-to-webp',
    name: 'Convert to WebP',
    description: 'Smaller pictures for websites that look the same.',
    to: '/convert#webp',
    category: 'photos',
    icon: Globe,
    keywords: 'jpg to webp png to webp image convert web',
  },
  {
    key: 'image-to-avif',
    name: 'Convert to AVIF',
    description: 'The newest picture format, for the smallest files.',
    to: '/convert#avif',
    category: 'photos',
    icon: Feather,
    keywords: 'jpg to avif png to avif image convert',
  },
  // Remove Background is switched off for now (see the note in catalog.ts).
  // {
  //   key: 'remove-background',
  //   name: 'Remove background',
  //   description: 'Cut out people, pets and products with AI that runs on your device.',
  //   to: '/remove-background#transparent',
  //   category: 'photos',
  //   icon: WandSparkles,
  //   keywords: 'transparent png cutout erase background bg remover ai',
  // },
  // {
  //   key: 'white-background',
  //   name: 'White background',
  //   description: 'Put the subject on clean white, for ID photos and shop listings.',
  //   to: '/remove-background#white',
  //   category: 'photos',
  //   icon: SquareUser,
  //   keywords: 'background remover product photo passport',
  // },
  // {
  //   key: 'background-colour',
  //   name: 'Change background colour',
  //   description: 'Swap the background of a photo for any colour you pick.',
  //   to: '/remove-background#color',
  //   category: 'photos',
  //   icon: Palette,
  //   keywords: 'color background replace',
  // },
  {
    key: 'photo-location',
    name: 'Remove photo location',
    description: 'See and strip hidden GPS, camera and date details before you share.',
    to: '/remove-location',
    category: 'photos',
    icon: MapPinOff,
    keywords: 'exif metadata gps privacy clean',
  },

  // Resize & crop
  {
    key: 'resize-image',
    name: 'Resize image',
    description: 'Scale photos to an exact width and height in pixels.',
    to: '/resize#custom',
    category: 'resize',
    icon: Scaling,
    keywords: 'pixels dimensions scale photo picture',
  },
  {
    key: 'crop-image',
    name: 'Crop image',
    description: 'Keep just the part you want, at full resolution.',
    to: '/resize#freehand',
    category: 'resize',
    icon: Crop,
    keywords: 'cut trim photo picture',
  },
  {
    key: 'rotate-image',
    name: 'Rotate & flip image',
    description: 'Turn photos in 90° steps or mirror them, in the crop editor.',
    to: '/resize#rotate',
    category: 'resize',
    icon: FlipHorizontal2,
    keywords: 'mirror turn sideways upside down photo picture',
  },
  {
    key: 'passport-photo',
    name: 'Passport photo',
    description: '35 × 45 mm at 300 DPI, ready to print or upload.',
    to: '/resize#passport',
    category: 'resize',
    icon: IdCard,
    keywords: 'id photo visa form 35x45',
  },
  {
    key: 'us-passport-photo',
    name: 'US passport & visa photo',
    description: 'A 2 × 2 inch square, 600 × 600 pixels.',
    to: '/resize#us-passport',
    category: 'resize',
    icon: BookUser,
    keywords: 'id photo 2x2 american',
  },
  {
    key: 'signature',
    name: 'Resize signature',
    description: 'A signature strip at the size exam and job forms ask for.',
    to: '/resize#signature',
    category: 'resize',
    icon: Signature,
    keywords: 'sign form upload kb',
  },
  {
    key: 'profile-picture',
    name: 'Profile picture',
    description: 'A square photo for WhatsApp, LinkedIn and other profiles.',
    to: '/resize#profile',
    category: 'resize',
    icon: CircleUser,
    keywords: 'avatar dp display picture square',
  },
  {
    key: 'instagram-post',
    name: 'Instagram post',
    description: '1080 px square posts, or 4:5 portrait from the same page.',
    to: '/resize#instagram-post',
    category: 'resize',
    icon: Camera,
    keywords: 'social media square portrait feed',
  },
  {
    key: 'story-size',
    name: 'Story & Status size',
    description: 'Full-screen 9:16 for Instagram Stories and WhatsApp Status.',
    to: '/resize#story',
    category: 'resize',
    icon: Smartphone,
    keywords: 'social media reel vertical 1080x1920',
  },
  {
    key: 'youtube-thumbnail',
    name: 'YouTube thumbnail',
    description: '1280 × 720 thumbnails at 16:9.',
    to: '/resize#youtube-thumbnail',
    category: 'resize',
    icon: MonitorPlay,
    keywords: 'social media video cover',
  },
  {
    key: 'social-banners',
    name: 'X & LinkedIn banners',
    description: 'Header images at 3:1 for X and 4:1 for LinkedIn.',
    to: '/resize#x-header',
    category: 'resize',
    icon: PanelTop,
    keywords: 'twitter header cover social media',
  },

  // Videos
  {
    key: 'compress-video',
    name: 'Compress video',
    description: "Shrink MP4, MOV, WebM and MKV using your device's video encoder.",
    to: '/compress',
    category: 'video',
    icon: Minimize2,
    keywords: 'reduce size shrink whatsapp email mb',
  },
  {
    key: 'video-to-mp4',
    name: 'Convert to MP4',
    description: 'MOV, MKV, AVI and more, as MP4 that plays everywhere.',
    to: '/convert#mp4',
    category: 'video',
    icon: Film,
    keywords: 'mov to mp4 mkv to mp4 avi to mp4 h264',
  },
  {
    key: 'video-to-webm',
    name: 'Convert to WebM',
    description: 'Open web video for sites and browsers.',
    to: '/convert#webm',
    category: 'video',
    icon: Globe,
    keywords: 'mp4 to webm vp9',
  },
  {
    key: 'video-to-gif',
    name: 'Video to GIF',
    description: 'Turn a clip into an animated GIF.',
    to: '/convert#gif',
    category: 'video',
    icon: ImagePlay,
    keywords: 'mp4 to gif animated animation',
  },
  {
    key: 'video-to-mp3',
    name: 'Video to MP3',
    description: 'Save the soundtrack as MP3, or as M4A or WAV.',
    to: '/convert#mp3',
    category: 'video',
    icon: Music,
    keywords: 'extract audio sound music m4a wav mp4 to mp3',
  },
  {
    key: 'trim-video',
    name: 'Trim video',
    description: 'Cut out the part you want, without re-encoding.',
    to: '/trim-video#trim',
    category: 'video',
    icon: Scissors,
    keywords: 'cut clip shorten',
  },
  {
    key: 'split-video',
    name: 'Split for WhatsApp Status',
    description: 'Break a long video into parts of up to 60 seconds.',
    to: '/trim-video#split',
    category: 'video',
    icon: Split,
    keywords: 'split video parts 30 seconds status story',
  },
  {
    key: 'mute-video',
    name: 'Mute video',
    description: 'Remove the sound and keep the picture exactly as it is.',
    to: '/trim-video#mute',
    category: 'video',
    icon: VolumeX,
    keywords: 'remove audio silent no sound',
  },
  {
    key: 'video-location',
    name: 'Remove video location',
    description: 'Strip the GPS and recording details from MP4 and MOV files.',
    to: '/remove-location',
    category: 'video',
    icon: MapPinOff,
    keywords: 'metadata gps privacy clean',
  },

  // Word documents
  {
    key: 'edit-word',
    name: 'Edit Word document',
    description: 'Open a DOCX, or a PDF as editable text, and change it.',
    to: '/edit-docx',
    category: 'word',
    icon: SquarePen,
    keywords: 'docx editor office',
  },
  {
    key: 'new-word',
    name: 'Create Word document',
    description: 'Start a blank page and save it as DOCX or PDF.',
    to: '/edit-docx#new',
    category: 'word',
    icon: FilePlus2,
    keywords: 'docx new blank write',
  },
  {
    key: 'merge-word',
    name: 'Merge Word files',
    description: 'Join several DOCX files into one that stays editable.',
    to: '/merge-documents',
    category: 'word',
    icon: Combine,
    keywords: 'docx combine join',
  },

  // PDF tools
  {
    key: 'merge-pdf',
    name: 'Merge PDF',
    description: 'Combine PDFs, Word files and photos into one PDF.',
    to: '/merge-documents',
    category: 'pdf',
    icon: Layers,
    keywords: 'combine join',
  },
  {
    key: 'split-pdf',
    name: 'Split PDF',
    description: 'Split a PDF into parts, or pull out the pages you need.',
    to: '/pdf#split',
    category: 'pdf',
    icon: Scissors,
    keywords: 'extract pages separate',
  },
  {
    key: 'compress-pdf',
    name: 'Compress PDF',
    description: 'Make a PDF smaller, down to a size limit if a form needs one.',
    to: '/pdf#compress',
    category: 'pdf',
    icon: Minimize2,
    keywords: 'reduce size shrink kb mb',
  },
  {
    key: 'edit-pdf',
    name: 'Edit PDF',
    description: 'Change text, add text and pictures, white out, highlight and draw.',
    to: '/edit-pdf',
    category: 'pdf',
    icon: FilePen,
    keywords: 'text annotate whiteout highlight',
  },
  {
    key: 'sign-pdf',
    name: 'Sign PDF',
    description: 'Draw, type or upload your signature and place it on any page.',
    to: '/pdf#sign',
    category: 'pdf',
    icon: PenLine,
    keywords: 'signature esign',
  },
  {
    key: 'organize-pdf',
    name: 'Organize pages',
    description: 'Reorder, rotate and delete pages, then save.',
    to: '/pdf#organize',
    category: 'pdf',
    icon: LayoutGrid,
    keywords: 'rotate pdf delete pages remove pages reorder sort',
  },
  {
    key: 'crop-pdf',
    name: 'Crop PDF',
    description: 'Trim white margins, or keep just part of a page.',
    to: '/pdf#crop',
    category: 'pdf',
    icon: Crop,
    keywords: 'margins',
  },
  {
    key: 'page-numbers',
    name: 'Add page numbers',
    description: 'Number every page, in the corner and style you choose.',
    to: '/pdf#page-numbers',
    category: 'pdf',
    icon: ListOrdered,
    keywords: 'numbering',
  },
  {
    key: 'watermark-pdf',
    name: 'Add watermark',
    description: 'Stamp text such as CONFIDENTIAL, or your logo, on every page.',
    to: '/pdf#watermark',
    category: 'pdf',
    icon: Stamp,
    keywords: 'stamp logo confidential draft',
  },
  {
    key: 'fill-forms',
    name: 'Fill PDF forms',
    description: 'Type answers into the boxes of application and tax forms.',
    to: '/pdf#forms',
    category: 'pdf',
    icon: ClipboardList,
    keywords: 'form fields application',
  },
  {
    key: 'protect-pdf',
    name: 'Protect PDF',
    description: 'Add a password, and choose whether others can print or copy.',
    to: '/pdf#protect',
    category: 'pdf',
    icon: Lock,
    keywords: 'password encrypt secure',
  },
  {
    key: 'unlock-pdf',
    name: 'Unlock PDF',
    description: 'Remove the password from a PDF you know the password to.',
    to: '/pdf#unlock',
    category: 'pdf',
    icon: LockOpen,
    keywords: 'remove password decrypt',
  },
  {
    key: 'clean-pdf',
    name: 'Remove PDF metadata',
    description: 'Remove the author, dates, software, comments and markup.',
    to: '/pdf#clean',
    category: 'pdf',
    icon: EyeOff,
    keywords: 'hidden data privacy properties',
  },
  {
    key: 'ocr-pdf',
    name: 'OCR PDF',
    description: 'Read the text in scans so you can search, select and copy it.',
    to: '/pdf#ocr',
    category: 'pdf',
    icon: ScanText,
    keywords: 'searchable text recognition scan',
  },
  {
    key: 'scan-documents',
    name: 'Scan documents',
    description: 'Straighten and clean up phone photos of papers into a PDF.',
    to: '/pdf#scan',
    category: 'pdf',
    icon: ScanLine,
    keywords: 'scanner camera paper',
  },

  // Convert to PDF
  {
    key: 'images-to-pdf',
    name: 'JPG to PDF',
    description: 'Photos and scans (JPG, PNG, HEIC, TIFF, GIF) in one PDF.',
    to: '/pdf#save',
    category: 'to-pdf',
    icon: Images,
    keywords: 'images photos png heic tiff picture',
  },
  {
    key: 'word-to-pdf',
    name: 'Word to PDF',
    description: 'DOCX to PDF with headings, tables and pictures kept.',
    to: '/docx-to-pdf',
    category: 'to-pdf',
    icon: FileText,
    keywords: 'docx doc',
  },
  {
    key: 'excel-to-pdf',
    name: 'Excel to PDF',
    description: 'XLSX and CSV sheets, fitted to the page with their formatting.',
    to: '/excel-to-pdf',
    category: 'to-pdf',
    icon: Sheet,
    keywords: 'xlsx csv spreadsheet',
  },
  {
    key: 'powerpoint-to-pdf',
    name: 'PowerPoint to PDF',
    description: 'PPTX slides as PDF pages, with their design kept.',
    to: '/powerpoint-to-pdf',
    category: 'to-pdf',
    icon: Presentation,
    keywords: 'pptx ppt slides presentation',
  },
  {
    key: 'text-to-pdf',
    name: 'Text & Markdown to PDF',
    description: 'TXT and MD files as clean, searchable PDFs.',
    to: '/text-to-pdf',
    category: 'to-pdf',
    icon: AlignLeft,
    keywords: 'txt md markdown plain text',
  },
  {
    key: 'rtf-to-pdf',
    name: 'RTF to PDF',
    description: 'Rich Text from WordPad, TextEdit or Word, as a PDF.',
    to: '/rtf-to-pdf',
    category: 'to-pdf',
    icon: Pilcrow,
    keywords: 'rich text wordpad textedit',
  },
  {
    key: 'html-to-pdf',
    name: 'HTML to PDF',
    description: 'Saved web pages and HTML files, as PDFs.',
    to: '/html-to-pdf',
    category: 'to-pdf',
    icon: Code,
    keywords: 'htm web page',
  },

  // Convert from PDF
  {
    key: 'pdf-to-word',
    name: 'PDF to Word',
    description: 'Editable DOCX files from PDFs, scans included.',
    to: '/pdf-to-docx',
    category: 'from-pdf',
    icon: FileText,
    keywords: 'docx doc editable',
  },
  {
    key: 'pdf-to-excel',
    name: 'PDF to Excel',
    description: 'Tables pulled out into spreadsheet rows and columns.',
    to: '/pdf-to-excel',
    category: 'from-pdf',
    icon: Sheet,
    keywords: 'xlsx spreadsheet tables',
  },
  {
    key: 'pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    description: 'Each page as a slide, with its text editable.',
    to: '/pdf-to-powerpoint',
    category: 'from-pdf',
    icon: Presentation,
    keywords: 'pptx ppt slides',
  },
  {
    key: 'pdf-to-jpg',
    name: 'PDF to JPG',
    description: 'Save pages as JPG pictures at the resolution you choose.',
    to: '/pdf#jpg',
    category: 'from-pdf',
    icon: FileImage,
    keywords: 'jpeg images pictures pages',
  },
  {
    key: 'pdf-to-png',
    name: 'PDF to PNG',
    description: 'Save pages as sharp, lossless PNG pictures.',
    to: '/pdf#png',
    category: 'from-pdf',
    icon: Image,
    keywords: 'images pictures pages',
  },
  {
    key: 'pdf-to-tiff',
    name: 'PDF to TIFF',
    description: 'One multi-page TIFF, or a file per page, in colour or grey.',
    to: '/pdf#tiff',
    category: 'from-pdf',
    icon: Layers,
    keywords: 'tif fax images',
  },
  {
    key: 'pdf-to-text',
    name: 'PDF to Text',
    description: 'Get the text out of a PDF as a TXT file, scans included.',
    to: '/pdf-to-text',
    category: 'from-pdf',
    icon: AlignLeft,
    keywords: 'txt extract text copy',
  },
  {
    key: 'pdf-to-html',
    name: 'PDF to HTML',
    description: 'A PDF as one clean web page that fits any screen.',
    to: '/pdf-to-html',
    category: 'from-pdf',
    icon: Code,
    keywords: 'web page htm',
  },
];

/** Features in category order, each category with its own. */
export const FEATURES_BY_CATEGORY: { category: Category; features: Feature[] }[] = CATEGORIES.map((category) => ({
  category,
  features: FEATURES.filter((f) => f.category === category.id),
}));

/** Shown as quick links under the home page search. */
export const POPULAR_FEATURES: Feature[] = [
  'compress-images',
  'heic-to-jpg',
  'merge-pdf',
  'pdf-to-word',
  // 'remove-background', // Remove Background is switched off for now.
  'passport-photo',
  'compress-pdf',
  'video-to-gif',
].map((key) => FEATURES.find((f) => f.key === key)!);

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const INDEX = FEATURES.map((f) => ({
  feature: f,
  name: normalize(f.name),
  text: normalize(`${f.name} ${f.description} ${f.keywords ?? ''} ${CATEGORY_BY_ID[f.category].name}`),
}));

/**
 * Features whose name, description, keywords or category contain every word of the query, best
 * first: names that start with the query, then names that contain it, then everything else.
 */
export function searchFeatures(query: string): Feature[] {
  const q = normalize(query);
  if (!q) return FEATURES;
  const words = q.split(' ');
  return INDEX.filter((entry) => words.every((w) => entry.text.includes(w)))
    .map((entry, order) => {
      const rank = entry.name.startsWith(q) ? 0 : entry.name.includes(q) ? 1 : words.every((w) => entry.name.includes(w)) ? 2 : 3;
      return { feature: entry.feature, rank, order };
    })
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map((r) => r.feature);
}
