export type PageRotation = 0 | 90 | 180 | 270;

/** A file added to the PDF tool: a PDF (many pages) or a photo (one page). */
export interface PdfSource {
  id: string;
  name: string;
  kind: 'pdf' | 'image';
  file: File;
  pageCount: number;
}

/**
 * Where a signature sits on a page, as fractions of the page as it is displayed (after rotation),
 * measured from the top-left corner. The height follows from the signature's own aspect ratio.
 */
export interface SignaturePlacement {
  id: string;
  x: number;
  y: number;
  width: number;
}

/** The signature the user drew, typed or uploaded: a trimmed PNG with a transparent background. */
export interface SignatureAsset {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

export type ScanFilter = 'none' | 'enhance' | 'gray' | 'bw';

/** Scan cleanup for a photo page: straighten to four corners, then an optional look. */
export interface ScanSettings {
  /** Top-left, top-right, bottom-right, bottom-left, as fractions of the photo. Null keeps the whole photo. */
  corners: [number, number][] | null;
  filter: ScanFilter;
}

/**
 * A change drawn on a page with Edit PDF. Positions and sizes are fractions of the page as it is
 * displayed (after rotation), from the top-left corner, like signature placements; text size is a
 * fraction of the page height, so an edit lands in the same place at any page size.
 */
export type PageEdit =
  | {
      id: string;
      kind: 'text';
      x: number;
      y: number;
      width: number;
      text: string;
      /** Font size as a fraction of the page height. */
      size: number;
      color: string;
      bold: boolean;
      italic: boolean;
      font: 'sans' | 'serif' | 'mono';
      align: 'left' | 'center' | 'right';
      /** Fill behind the text box, which covers what was there (used when replacing text). */
      background?: string;
      /** Height of the covered area, when replacing text, as a fraction of the page height. */
      coverHeight?: number;
    }
  | {
      id: string;
      /** white-out covers, highlight tints, box outlines. */
      kind: 'whiteout' | 'highlight' | 'box';
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    }
  | {
      id: string;
      kind: 'draw';
      /** Strokes, each a list of points as fractions of the page. */
      strokes: [number, number][][];
      color: string;
      /** Line width as a fraction of the page width. */
      thickness: number;
    }
  | {
      id: string;
      kind: 'image';
      x: number;
      y: number;
      width: number;
      height: number;
      /** Key into the PDF store's edit images. */
      imageId: string;
    };

/** One page on the board. Pages keep a pointer to their source, so reordering never touches file data. */
export interface PdfPage {
  id: string;
  sourceId: string;
  /** Page index within the source PDF; always 0 for photos. */
  index: number;
  /** Extra clockwise rotation chosen by the user, on top of the page's own rotation. */
  rotation: PageRotation;
  selected: boolean;
  thumbUrl: string | null;
  signatures: SignaturePlacement[];
  /** Photo pages only. */
  scan?: ScanSettings;
  /** Changes made with Edit PDF. */
  edits?: PageEdit[];
}

export type PdfPageSize = 'fit' | 'a4' | 'letter';
export type PdfOrientation = 'auto' | 'portrait' | 'landscape';
export type PdfMargin = 'none' | 'small' | 'large';
export type NumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';
export type NumberFormat = 'n' | 'page-n' | 'page-n-of-total' | 'n-slash-total';
export type CompressLevel = 'light' | 'medium' | 'strong';

export interface PageNumberSettings {
  enabled: boolean;
  position: NumberPosition;
  format: NumberFormat;
  start: number;
  /** Leaves the first page (often a cover) unnumbered; numbering still counts it. */
  skipFirst: boolean;
}

export interface WatermarkSettings {
  enabled: boolean;
  /** Text, or a logo uploaded into this tab. Settings saved before logos existed have no kind: text. */
  kind?: 'text' | 'logo';
  text: string;
  size: 'small' | 'medium' | 'large';
  diagonal: boolean;
  /** 0.05 to 0.5. */
  opacity: number;
}

export interface PdfSettings {
  /** Page setup for photos. PDF pages keep their own size. */
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
  margin: PdfMargin;
  /** 'standard' scales phone photos to about 200 DPI on the page, which keeps files small. */
  photoQuality: 'standard' | 'original';
  splitEvery: number;
  imageFormat: 'jpeg' | 'png';
  imageDpi: 72 | 150 | 300;
  pageNumbers: PageNumberSettings;
  watermark: WatermarkSettings;
  compressLevel: CompressLevel;
  compressTargetKB: number | null;
  /** Lets "Compress" turn pages into pictures when recompressing photos is not enough. */
  allowFlatten: boolean;
  /** Drops comments, highlights, sticky notes and other markup from saved PDFs. Links stay. */
  removeComments: boolean;
  /** Turns pages with white-out or retyped text into pictures, so the covered text is really gone. */
  flattenCovered: boolean;
}
