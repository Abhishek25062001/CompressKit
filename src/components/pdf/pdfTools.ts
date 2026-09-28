import {
  ClipboardList,
  Crop,
  EyeOff,
  FileDown,
  FileImage,
  FilePen,
  Image,
  Images,
  Layers,
  LayoutGrid,
  ListOrdered,
  Lock,
  LockOpen,
  Minimize2,
  PenLine,
  ScanLine,
  ScanText,
  Scissors,
  Stamp,
  type LucideIcon,
} from 'lucide-react';
import { usePdfSettingsStore } from '../../store/pdfStore';
import type { PdfImageFormat } from '../../types/pdf';

export type PdfTab = 'save' | 'edit' | 'split' | 'crop' | 'images' | 'compress' | 'sign' | 'scan' | 'forms' | 'protect' | 'clean' | 'ocr';

export interface PdfToolInfo {
  value: PdfTab;
  /** Short label for the panel's tab grid. */
  label: string;
  /** Name on the tool picker. */
  name: string;
  description: string;
  /** Drop zone title once the tool is picked. */
  dropTitle: string;
  /** Formats named on the drop zone. */
  badges: string[];
  icon: LucideIcon;
}

const ANY = ['PDF', 'DOCX', 'JPG', 'PNG', 'HEIC', 'TIFF', 'GIF'];
const PDF_ONLY = ['PDF'];
const PHOTOS = ['JPG', 'PNG', 'HEIC', 'WebP', 'TIFF'];

/** The tools of the PDF page, in the order shown on the picker and in the panel. */
export const PDF_TOOLS: PdfToolInfo[] = [
  {
    value: 'save',
    label: 'Save',
    name: 'Merge & photos to PDF',
    description: 'Combine PDFs, Word files and photos into one PDF, or save pages in a new order.',
    dropTitle: 'Drop PDFs, Word files or photos to combine',
    badges: ANY,
    icon: FileDown,
  },
  {
    value: 'edit',
    label: 'Edit',
    name: 'Edit PDF',
    description: 'Change text, add text and pictures, white out, highlight or draw.',
    dropTitle: 'Drop a PDF to edit',
    badges: PDF_ONLY,
    icon: FilePen,
  },
  {
    value: 'split',
    label: 'Split',
    name: 'Split PDF',
    description: 'Split a PDF into parts, or pull out just the pages you need.',
    dropTitle: 'Drop a PDF to split',
    badges: PDF_ONLY,
    icon: Scissors,
  },
  {
    value: 'crop',
    label: 'Crop',
    name: 'Crop PDF',
    description: 'Trim white margins automatically, or drag a box to keep just part of a page.',
    dropTitle: 'Drop a PDF or photos to crop',
    badges: ['PDF', ...PHOTOS],
    icon: Crop,
  },
  {
    value: 'images',
    label: 'Images',
    name: 'PDF to images',
    description: 'Save pages as JPG, PNG, BMP or TIFF at the resolution you choose.',
    dropTitle: 'Drop a PDF to turn into images',
    badges: PDF_ONLY,
    icon: Images,
  },
  {
    value: 'compress',
    label: 'Compress',
    name: 'Compress PDF',
    description: 'Make a PDF smaller, down to a size limit if an upload form asks for one.',
    dropTitle: 'Drop a PDF to compress',
    badges: PDF_ONLY,
    icon: Minimize2,
  },
  {
    value: 'sign',
    label: 'Sign',
    name: 'Sign PDF',
    description: 'Draw, type or upload your signature and place it on any page.',
    dropTitle: 'Drop a PDF to sign',
    badges: PDF_ONLY,
    icon: PenLine,
  },
  {
    value: 'scan',
    label: 'Scan',
    name: 'Scan documents',
    description: 'Straighten and clean up phone photos of papers, then save them as a PDF.',
    dropTitle: 'Drop photos of your documents',
    badges: PHOTOS,
    icon: ScanLine,
  },
  {
    value: 'forms',
    label: 'Forms',
    name: 'Fill PDF forms',
    description: 'Type answers into the fill-in boxes of application and tax forms.',
    dropTitle: 'Drop a PDF form to fill',
    badges: PDF_ONLY,
    icon: ClipboardList,
  },
  {
    value: 'protect',
    label: 'Protect',
    name: 'Protect PDF',
    description: 'Add a password, and choose whether others can print or copy.',
    dropTitle: 'Drop a PDF to protect',
    badges: PDF_ONLY,
    icon: Lock,
  },
  {
    value: 'clean',
    label: 'Clean',
    name: 'Remove hidden data',
    description: 'See and remove who made a file, when and with what, plus comments and markup.',
    dropTitle: 'Drop a PDF to clean',
    badges: PDF_ONLY,
    icon: EyeOff,
  },
  {
    value: 'ocr',
    label: 'OCR',
    name: 'OCR: searchable PDF',
    description: 'Read the text in scans so you can search, select and copy it.',
    dropTitle: 'Drop a scanned PDF or photos',
    badges: ['PDF', ...PHOTOS],
    icon: ScanText,
  },
];

/** Something the PDF page can be opened for: one of its tools, or a job done inside one. */
export interface PdfJob extends Omit<PdfToolInfo, 'value' | 'label'> {
  /** The panel tab that does the job. */
  tab: PdfTab;
  /** Turns on the setting the job needs, such as page numbers. */
  apply?: () => void;
}

const settings = () => usePdfSettingsStore.getState();
const pagesAs = (imageFormat: PdfImageFormat) => () => settings().update({ imageFormat });

/**
 * Jobs with links of their own ("/pdf#page-numbers") that are done inside one of the tools
 * above: the page names the job above the drop zone and opens its tab with the right setting on.
 */
const PDF_SHORTCUTS: Record<string, PdfJob> = {
  organize: {
    tab: 'save',
    name: 'Organize pages',
    description: 'Drag pages to reorder them, and rotate or delete them with the buttons on each page. Then save.',
    dropTitle: 'Drop a PDF to organize',
    badges: PDF_ONLY,
    icon: LayoutGrid,
  },
  'page-numbers': {
    tab: 'save',
    name: 'Add page numbers',
    description: 'Page numbers are switched on under "Add to every page", where you can pick their corner and style.',
    dropTitle: 'Drop a PDF to number its pages',
    badges: PDF_ONLY,
    icon: ListOrdered,
    apply: () => settings().update({ pageNumbers: { ...settings().pageNumbers, enabled: true } }),
  },
  watermark: {
    tab: 'save',
    name: 'Add watermark',
    description: 'The watermark is switched on under "Add to every page": type your text or add a logo there.',
    dropTitle: 'Drop a PDF to watermark',
    badges: PDF_ONLY,
    icon: Stamp,
    apply: () => settings().update({ watermark: { ...settings().watermark, enabled: true } }),
  },
  unlock: {
    tab: 'save',
    name: 'Unlock PDF',
    description: 'Add the locked PDF and type its password when asked. The copy you save has no password.',
    dropTitle: 'Drop a password-protected PDF',
    badges: PDF_ONLY,
    icon: LockOpen,
  },
  jpg: {
    tab: 'images',
    name: 'PDF to JPG',
    description: 'Save pages as JPG pictures at the resolution you choose.',
    dropTitle: 'Drop a PDF to turn into JPGs',
    badges: PDF_ONLY,
    icon: FileImage,
    apply: pagesAs('jpeg'),
  },
  png: {
    tab: 'images',
    name: 'PDF to PNG',
    description: 'Save pages as lossless PNG pictures at the resolution you choose.',
    dropTitle: 'Drop a PDF to turn into PNGs',
    badges: PDF_ONLY,
    icon: Image,
    apply: pagesAs('png'),
  },
  tiff: {
    tab: 'images',
    name: 'PDF to TIFF',
    description: 'Save pages as one multi-page TIFF or a file per page, in colour or grey.',
    dropTitle: 'Drop a PDF to turn into TIFF',
    badges: PDF_ONLY,
    icon: Layers,
    apply: pagesAs('tiff'),
  },
};

/** Every PDF page hash ("/pdf#split", "/pdf#unlock") and what it opens. */
const PDF_JOBS: Record<string, PdfJob> = {
  ...Object.fromEntries(
    PDF_TOOLS.map((t) => [t.value, { name: t.name, description: t.description, dropTitle: t.dropTitle, badges: t.badges, icon: t.icon, tab: t.value }]),
  ),
  ...PDF_SHORTCUTS,
};

/** The job a PDF page hash names, or undefined. Own names only, so "#constructor" is not a job. */
export function pdfJob(key: string | null): PdfJob | undefined {
  return key !== null && Object.hasOwn(PDF_JOBS, key) ? PDF_JOBS[key] : undefined;
}
