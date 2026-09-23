export type PageRotation = 0 | 90 | 180 | 270;

/** A file added to the PDF tool: a PDF (many pages) or a photo (one page). */
export interface PdfSource {
  id: string;
  name: string;
  kind: 'pdf' | 'image';
  file: File;
  pageCount: number;
}

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
}

export type PdfPageSize = 'fit' | 'a4' | 'letter';
export type PdfOrientation = 'auto' | 'portrait' | 'landscape';
export type PdfMargin = 'none' | 'small' | 'large';

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
}
