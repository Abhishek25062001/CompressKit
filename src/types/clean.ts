/** What kind of personal detail a piece of hidden information reveals. */
export type HiddenKind = 'location' | 'device' | 'date' | 'person' | 'software' | 'other';

/** One piece of hidden information found inside a photo or video. */
export interface HiddenInfo {
  kind: HiddenKind;
  label: string;
  value: string;
}

/** The outcome of reading a file: what it hides, and a copy without it. */
export interface CleanOutput {
  blob: Blob;
  removed: HiddenInfo[];
  notes: string[];
}
