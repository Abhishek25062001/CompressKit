export type ConvertImageTarget = 'jpeg' | 'png' | 'webp' | 'avif';
export type ConvertVideoTarget = 'mp4' | 'webm' | 'gif' | 'mp3' | 'm4a' | 'wav';
export type AudioTarget = Extract<ConvertVideoTarget, 'mp3' | 'm4a' | 'wav'>;
/** Output width of an animated GIF. 'original' keeps the source width. */
export type GifWidth = 'original' | 720 | 480 | 320;

export interface ConvertSettings {
  image: ConvertImageTarget;
  /** 1 to 100, used by JPEG, WebP and AVIF. PNG is always lossless. */
  imageQuality: number;
  video: ConvertVideoTarget;
  gifWidth: GifWidth;
}
