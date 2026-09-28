import {
  ArrowDownUp,
  ArrowLeftRight,
  Combine,
  Eraser,
  FileInput,
  FileOutput,
  Heading,
  Highlighter,
  Languages,
  ListOrdered,
  Replace,
  SquarePen,
  Table2,
  TextCursorInput,
  AlignLeft,
  Code,
  FileCode,
  FileType,
  Globe,
  Link,
  Palette as PaletteIcon,
  Pilcrow,
  Printer,
  Crop,
  Eye,
  FileImage,
  FilePen,
  FileStack,
  FileText,
  Film,
  Gauge,
  History,
  Images,
  Layers,
  MapPinOff,
  Maximize,
  Palette,
  Ruler,
  ScanText,
  Scissors,
  Share2,
  ShieldCheck,
  Shrink,
  Smartphone,
  SplitSquareHorizontal,
  Target,
  Undo2,
  WandSparkles,
  WifiOff,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ToolId } from './catalog';

export interface Highlight {
  icon: LucideIcon;
  title: string;
  body: string;
}

export interface ToolContent {
  icon: LucideIcon;
  /** Three steps from adding a file to downloading the result. */
  steps: [string, string][];
  highlights: Highlight[];
}

/** What each tool page explains below the tool itself. Search-engine text lives in catalog.ts. */
export const TOOL_CONTENT: Record<ToolId, ToolContent> = {
  compress: {
    icon: Shrink,
    steps: [
      ['Add your files', 'Drop, paste or pick images and videos. Mix both in one batch.'],
      ['Pick a preset', 'Balanced suits most files. Fine-tune quality, size and format, or set a KB limit.'],
      ['Compare and download', 'Check each result against the original, then save files one by one or as a ZIP.'],
    ],
    highlights: [
      { icon: Zap, title: 'Hardware-accelerated video', body: 'Uses WebCodecs for fast encoding when your browser supports it, with FFmpeg.wasm as a universal fallback.' },
      { icon: Target, title: 'Hit a file size', body: 'Type a limit such as 50 KB or 200 KB, as upload forms ask for, and get the best quality that fits.' },
      { icon: Layers, title: 'Batch processing', body: 'Add many files at once, compress them in parallel and download everything as a single ZIP.' },
      { icon: SplitSquareHorizontal, title: 'See the difference', body: 'A before and after slider for images and side by side playback for videos.' },
      { icon: Undo2, title: 'Never bigger', body: 'If re-encoding would not make a file smaller, you get the original back instead of a larger copy.' },
      { icon: WifiOff, title: 'Works offline', body: 'After your first visit the tool works without a connection, and the video engine is cached after first use.' },
    ],
  },
  convert: {
    icon: ArrowLeftRight,
    steps: [
      ['Add your files', 'Photos, including iPhone HEIC, and videos in almost any format.'],
      ['Choose the format', 'JPG, PNG, WebP or AVIF for photos; MP4, WebM, GIF, MP3, M4A or WAV for videos.'],
      ['Download', 'Save each file, or all of them as a ZIP.'],
    ],
    highlights: [
      { icon: Smartphone, title: 'iPhone photos to JPG', body: 'HEIC photos become JPGs that open everywhere, with the right rotation.' },
      { icon: Film, title: 'Video to GIF or audio', body: 'Make a looping GIF from a clip, or pull out the sound as MP3, M4A or WAV.' },
      { icon: FileImage, title: 'Always the format you asked for', body: 'The converter never swaps in the original because it was smaller.' },
      { icon: History, title: 'Older formats too', body: 'AVI, WMV, FLV and 3GP videos and BMP images are read as well.' },
    ],
  },
  resize: {
    icon: Crop,
    steps: [
      ['Add your photos', 'JPG, PNG, WebP, AVIF and BMP.'],
      ['Pick a size', 'Passport, visa, signature, profile picture, post, thumbnail, or your own size.'],
      ['Adjust and download', 'Move the crop if needed, then save photos with the exact pixel size.'],
    ],
    highlights: [
      { icon: Ruler, title: 'Exact sizes for forms', body: 'Passport and visa photos, signatures and document sizes at 300 DPI, ready for online applications.' },
      { icon: Target, title: 'Optional KB limit', body: 'Many forms also cap the file size. Set it, and only the quality is lowered until the photo fits.' },
      { icon: Crop, title: 'A real crop editor', body: 'Drag and resize the crop with the shape locked, by mouse, finger or keyboard.' },
      { icon: Maximize, title: 'Freehand when you need it', body: 'Crop any rectangle and keep the original resolution.' },
    ],
  },
  background: {
    icon: WandSparkles,
    steps: [
      ['Add your photos', 'People, pets, products or cars with some background around them work best.'],
      ['Let the AI cut it out', 'About a second per photo on your graphics card. Nothing is uploaded.'],
      ['Download', 'A transparent PNG or WebP, or the subject on white or any colour.'],
    ],
    highlights: [
      { icon: ShieldCheck, title: 'AI that stays on your device', body: 'The model runs in your browser. The first photo downloads it once, then it is ready even offline.' },
      { icon: Palette, title: 'Transparent or any colour', body: 'Keep the transparency for designs, or place the subject on white or a colour of your choice.' },
      { icon: Maximize, title: 'Crop to the subject', body: 'Remove the empty space around the cut-out, for stickers and product listings.' },
      { icon: SplitSquareHorizontal, title: 'Compare the result', body: 'Slide between the original photo and the cut-out to check the edges.' },
    ],
  },
  trim: {
    icon: Scissors,
    steps: [
      ['Add a video', 'MP4, MOV, WebM or MKV, straight from your phone or camera.'],
      ['Choose the part', 'Drag the handles on the timeline, or type the start and end times.'],
      ['Save it', 'Download one clip, or every Status-length part as a ZIP.'],
    ],
    highlights: [
      { icon: Images, title: 'Split for WhatsApp Status', body: 'Cut long videos into 60-second parts that play back to back, and never run over the limit.' },
      { icon: Gauge, title: 'Lossless and instant', body: 'Fast cuts copy the video without re-encoding: no quality loss, usually in under a second.' },
      { icon: Scissors, title: 'Frame-exact when needed', body: 'Exact mode cuts on the precise frame and saves an MP4 that plays everywhere.' },
      { icon: Share2, title: 'Share from your phone', body: 'On a phone, send the parts straight to WhatsApp from the share sheet.' },
    ],
  },
  clean: {
    icon: MapPinOff,
    steps: [
      ['Add photos or videos', 'JPG, PNG, HEIC, WebP, AVIF, MP4, MOV and 3GP.'],
      ['See what they reveal', 'Each file shows the location, camera and date hidden inside it.'],
      ['Download clean copies', 'Share them without giving away where and when they were taken.'],
    ],
    highlights: [
      { icon: Eye, title: 'See exactly what is hidden', body: 'GPS coordinates, place names, camera and lens, dates, names and software, listed per file.' },
      { icon: ShieldCheck, title: 'Nothing re-encoded', body: 'Only the hidden details are removed. The picture and sound stay exactly the same.' },
      { icon: Undo2, title: 'Still the right way up', body: 'Orientation and colour profiles are kept, so photos look the same as before.' },
      { icon: Film, title: 'Videos too', body: 'Removes the location phones write into MP4 and MOV videos, even large ones, in seconds.' },
    ],
  },
  pdf: {
    icon: FileText,
    steps: [
      ['Add PDFs, Word files and photos', 'Every page and photo appears on one board.'],
      ['Arrange and choose', 'Reorder, rotate or remove pages, then pick what to do with them.'],
      ['Save', 'Download one PDF, separate files, or pages as images.'],
    ],
    highlights: [
      { icon: FileImage, title: 'Photos to PDF', body: 'Turn phone photos into an A4 or Letter PDF, and straighten and clean up photographed pages.' },
      { icon: FileStack, title: 'Merge, split and reorder', body: 'Combine PDFs, Word files and photos, pull out pages, or split a document into parts.' },
      { icon: TextCursorInput, title: 'Edit pages', body: 'Change existing text, add text and pictures, white out, highlight and draw.' },
      { icon: FilePen, title: 'Sign and fill forms', body: 'Draw, type or upload a signature, and fill in PDF form fields.' },
      { icon: ScanText, title: 'Compress, protect and OCR', body: 'Shrink scanned PDFs, add a password, and make scans searchable.' },
    ],
  },
  'edit-pdf': {
    icon: FilePen,
    steps: [
      ['Add your PDF', 'Its pages appear on a board. Photos of documents work too.'],
      ['Edit a page', 'Press Edit on a page: retype text, add text boxes and pictures, white out, highlight or draw.'],
      ['Download', 'Save the edited PDF. Your changes become part of the pages.'],
    ],
    highlights: [
      { icon: Replace, title: 'Change existing text', body: 'Click a line to retype it. The old text is covered in its background colour and your text is written in its place.' },
      { icon: TextCursorInput, title: 'Add text anywhere', body: 'Fill in forms that have no fields, add notes or dates, in any size, colour and style.' },
      { icon: Eraser, title: 'White-out', body: 'Cover mistakes, old details or anything you do not want to share.' },
      { icon: Highlighter, title: 'Highlight, draw and box', body: 'Mark up a page with highlights, boxes and freehand drawing.' },
      { icon: Images, title: 'Pictures and logos', body: 'Place a photo, stamp or logo on any page and size it by dragging.' },
      { icon: ShieldCheck, title: 'Stays on your device', body: 'The PDF is edited in your browser. Nothing is uploaded, so contracts and IDs stay private.' },
    ],
  },
  merge: {
    icon: Combine,
    steps: [
      ['Add your files', 'PDFs, Word documents and photos, as many as you like.'],
      ['Put them in order', 'Drag pages to reorder, rotate them or remove the ones you do not need.'],
      ['Merge', 'Download one PDF, or join Word files into one Word document.'],
    ],
    highlights: [
      { icon: Layers, title: 'Mix file types', body: 'Combine PDFs, DOCX files and photos into a single PDF.' },
      { icon: ArrowDownUp, title: 'Page by page control', body: 'Every page is on the board, so you can reorder, rotate and remove pages across files.' },
      { icon: FileText, title: 'Word into Word', body: 'Join several Word documents into one .docx that you can keep editing.' },
      { icon: ShieldCheck, title: 'Private', body: 'Files are merged in your browser and never uploaded.' },
    ],
  },
  'docx-to-pdf': {
    icon: FileOutput,
    steps: [
      ['Add Word files', 'Drop one or many .docx files.'],
      ['Wait a moment', 'Each document is laid out as PDF pages on your device.'],
      ['Download', 'Save each PDF, or all of them as a ZIP.'],
    ],
    highlights: [
      { icon: Heading, title: 'Keeps the structure', body: 'Headings, bold and italic, colours, lists, tables, links and pictures come across.' },
      { icon: TextCursorInput, title: 'Real text', body: 'Text in the PDF stays selectable and searchable, not a picture of the page.' },
      { icon: Languages, title: 'Any language', body: 'Hindi, Arabic, Chinese and other scripts are drawn by your browser so they show up correctly.' },
      { icon: WifiOff, title: 'No Office needed', body: 'Works in any modern browser, offline after your first visit, without uploading the file.' },
    ],
  },
  'pdf-to-docx': {
    icon: FileInput,
    steps: [
      ['Add PDFs', 'Drop one or many PDFs, including scans.'],
      ['Choose options', 'Keep pictures, read scanned pages with OCR, and keep page breaks.'],
      ['Download', 'Open the .docx in Word, Google Docs or Pages, or edit it right here.'],
    ],
    highlights: [
      { icon: Heading, title: 'Headings and lists', body: 'Larger text becomes headings, and bullets and numbers become real lists.' },
      { icon: Images, title: 'Pictures included', body: 'Photos and logos are pulled out and placed where they appear.' },
      { icon: ScanText, title: 'Scans too', body: 'Scanned pages are read with OCR into text you can edit.' },
      { icon: ShieldCheck, title: 'Private', body: 'Converted in your browser. Your PDF is never uploaded.' },
    ],
  },
  'edit-docx': {
    icon: SquarePen,
    steps: [
      ['Open a document', 'Drop a Word file or PDF, or start a blank page.'],
      ['Edit', 'Type, format text, add headings, lists, tables, links and pictures.'],
      ['Save', 'Download as Word (.docx) or PDF.'],
    ],
    highlights: [
      { icon: SquarePen, title: 'Familiar editing', body: 'Bold, italic, underline, colours, fonts and sizes, alignment and indents, with undo and redo.' },
      { icon: ListOrdered, title: 'Lists and headings', body: 'Bulleted and numbered lists, titles, headings and quotes.' },
      { icon: Table2, title: 'Tables and pictures', body: 'Insert tables, paste or drop pictures, and add page breaks.' },
      { icon: FileInput, title: 'Edit PDFs as text', body: 'Open a PDF to turn it into an editable document, then save it as Word or PDF.' },
    ],
  },
  'text-to-pdf': {
    icon: FileType,
    steps: [
      ['Add text files', 'Drop .txt or Markdown (.md) files, one or many.'],
      ['Pick a look', 'Monospace, sans or serif, the text size, and A4 or Letter pages.'],
      ['Download', 'Save each PDF, or all of them as a ZIP.'],
    ],
    highlights: [
      { icon: AlignLeft, title: 'Lines kept exactly', body: 'Indentation, blank lines, tabs and columns lined up with spaces stay where they were.' },
      { icon: Code, title: 'Markdown formatted', body: 'Headings, bold and italic, lists, tables, code blocks and links become a formatted document.' },
      { icon: TextCursorInput, title: 'Real text', body: 'Text in the PDF is selectable and searchable, and long lines wrap to the page.' },
      { icon: Languages, title: 'Any encoding', body: 'UTF-8, UTF-16 and older Windows files are all read correctly.' },
    ],
  },
  'rtf-to-pdf': {
    icon: Pilcrow,
    steps: [
      ['Add RTF files', 'Drop Rich Text documents from WordPad, TextEdit, Word or any editor.'],
      ['Wait a moment', 'Each document is laid out as PDF pages on your device.'],
      ['Download', 'Save each PDF, or all of them as a ZIP.'],
    ],
    highlights: [
      { icon: PaletteIcon, title: 'Formatting kept', body: 'Fonts, sizes, bold, italic, underline, colours and highlighting come across.' },
      { icon: Table2, title: 'Tables and lists', body: 'Tables with shaded cells, bulleted and numbered lists, and headings stay structured.' },
      { icon: Link, title: 'Links and pictures', body: 'Hyperlinks still work in the PDF, and embedded PNG and JPEG pictures are placed in the text.' },
      { icon: Languages, title: 'Every language', body: 'Unicode and older code pages (Cyrillic, Greek, Central European and more) are decoded properly.' },
    ],
  },
  'html-to-pdf': {
    icon: FileCode,
    steps: [
      ['Add HTML files', 'Drop saved web pages, email exports or any .html file.'],
      ['Choose a page size', 'A4 or Letter. The file is read with its own styles applied.'],
      ['Download', 'Save the PDF, or open the print view for an exact copy of the layout.'],
    ],
    highlights: [
      { icon: PaletteIcon, title: 'Styles applied', body: 'Stylesheets decide the fonts, colours, sizes and alignment, just as in a browser.' },
      { icon: Table2, title: 'Structure kept', body: 'Headings, tables with shading, lists, links and embedded pictures come across as real text.' },
      { icon: Printer, title: 'Exact layout option', body: "Need it to look exactly like the page? The print view saves a PDF with your browser's own engine." },
      { icon: Globe, title: 'Safe to open', body: 'Scripts in the file never run and nothing is fetched from the web or uploaded.' },
    ],
  },
  'pdf-to-text': {
    icon: FileText,
    steps: [
      ['Add PDFs', 'Drop one or many PDFs, including scanned documents.'],
      ['Choose how', 'Paragraphs in reading order, or the page layout kept with columns lined up.'],
      ['Download', 'Save each .txt file, or all of them as a ZIP.'],
    ],
    highlights: [
      { icon: AlignLeft, title: 'Two arrangements', body: 'Reading order for copying into documents, or layout mode that keeps tables and columns lined up.' },
      { icon: ScanText, title: 'Scans too', body: 'Scanned pages and photos of documents are read with OCR.' },
      { icon: ListOrdered, title: 'Lists and tables', body: 'Bullets and numbers are kept, and table cells are separated by tabs for pasting into a spreadsheet.' },
      { icon: ShieldCheck, title: 'Private', body: 'Read in your browser. Your PDF is never uploaded.' },
    ],
  },
  'pdf-to-html': {
    icon: FileCode,
    steps: [
      ['Add PDFs', 'Drop one or many PDFs.'],
      ['Choose options', 'Include pictures, and read scanned pages with OCR.'],
      ['Download', 'Save a single .html file that opens in any browser, even offline.'],
    ],
    highlights: [
      { icon: Heading, title: 'Real structure', body: 'Headings, paragraphs, bulleted and numbered lists, tables and links, not positioned boxes.' },
      { icon: Smartphone, title: 'Reflows on phones', body: 'The page adapts to any screen size, and prints with page breaks where the PDF had them.' },
      { icon: Images, title: 'One file', body: 'Pictures are embedded, so there is no folder of images to keep with it.' },
      { icon: ShieldCheck, title: 'Private', body: 'Converted in your browser. Your PDF is never uploaded.' },
    ],
  },
};
