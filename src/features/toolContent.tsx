import {
  ArrowLeftRight,
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
      ['Add PDFs and photos', 'Every page and photo appears on one board.'],
      ['Arrange and choose', 'Reorder, rotate or remove pages, then pick what to do with them.'],
      ['Save', 'Download one PDF, separate files, or pages as images.'],
    ],
    highlights: [
      { icon: FileImage, title: 'Photos to PDF', body: 'Turn phone photos into an A4 or Letter PDF, and straighten and clean up photographed pages.' },
      { icon: FileStack, title: 'Merge, split and reorder', body: 'Combine files, pull out pages, or split a document into parts.' },
      { icon: FilePen, title: 'Sign and fill forms', body: 'Draw, type or upload a signature, and fill in PDF form fields.' },
      { icon: ScanText, title: 'Compress, protect and OCR', body: 'Shrink scanned PDFs, add a password, and make scans searchable.' },
    ],
  },
};
