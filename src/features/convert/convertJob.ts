import { DEFAULT_IMAGE_SETTINGS, DEFAULT_VIDEO_SETTINGS } from '../../constants/presets';
import type { ConvertSettings, ConvertVideoTarget } from '../../types/convert';
import type { ImageSettings, VideoSettings } from '../../types/settings';
import type { VideoOutput } from '../../types/worker';

/** Conversion keeps quality high: the goal is a different format, not a smaller file. */
const CONVERT_VIDEO_QUALITY = 80;
const GIF_FPS = 12;

export function convertImageSettings(s: ConvertSettings): ImageSettings {
  return {
    ...DEFAULT_IMAGE_SETTINGS,
    format: s.image,
    // 100 makes the PNG encoder lossless instead of palette-reduced.
    quality: s.image === 'png' ? 100 : s.imageQuality,
    preserveResolution: true,
  };
}

export function convertVideoSettings(s: ConvertSettings): VideoSettings {
  return {
    ...DEFAULT_VIDEO_SETTINGS,
    container: s.video === 'webm' ? 'webm' : 'mp4',
    codec: s.video === 'webm' ? 'vp9' : 'h264',
    quality: CONVERT_VIDEO_QUALITY,
    resolution: 'original',
    fps: 'original',
    audioBitrate: 160,
    engine: 'auto',
  };
}

export function convertVideoOutput(s: ConvertSettings): VideoOutput {
  switch (s.video) {
    case 'gif':
      return { type: 'gif', width: s.gifWidth === 'original' ? null : s.gifWidth, fps: GIF_FPS };
    case 'mp3':
    case 'm4a':
    case 'wav':
      return { type: 'audio', format: s.video };
    default:
      return { type: 'video' };
  }
}

export const VIDEO_TARGET_LABEL: Record<ConvertVideoTarget, string> = {
  mp4: 'MP4 video',
  webm: 'WebM video',
  gif: 'Animated GIF',
  mp3: 'MP3 audio',
  m4a: 'M4A audio',
  wav: 'WAV audio',
};
