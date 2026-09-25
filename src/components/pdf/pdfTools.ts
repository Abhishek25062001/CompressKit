import { ClipboardList, EyeOff, FileDown, FilePen, Images, Lock, Minimize2, PenLine, ScanLine, ScanText, Scissors, type LucideIcon } from 'lucide-react';

export type PdfTab = 'save' | 'edit' | 'split' | 'images' | 'compress' | 'sign' | 'scan' | 'forms' | 'protect' | 'clean' | 'ocr';

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

const ANY = ['PDF', 'DOCX', 'JPG', 'PNG', 'HEIC', 'WebP'];
const PDF_ONLY = ['PDF'];
const PHOTOS = ['JPG', 'PNG', 'HEIC', 'WebP'];

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
    value: 'images',
    label: 'Images',
    name: 'PDF to images',
    description: 'Save pages as JPG or PNG at the resolution you choose.',
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

export const PDF_TOOL_BY_TAB = Object.fromEntries(PDF_TOOLS.map((t) => [t.value, t])) as Record<PdfTab, PdfToolInfo>;
