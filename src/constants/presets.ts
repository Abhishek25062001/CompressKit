import type {
  CompressionSettings,
  ImageSettings,
  PresetId,
  VideoSettings,
} from '../types/settings';

export interface PresetDef {
  id: PresetId;
  name: string;
  description: string;
  imageQuality: number;
  videoQuality: number;
  audioBitrate: VideoSettings['audioBitrate'];
}

export const PRESETS: PresetDef[] = [
  {
    id: 'max-quality',
    name: 'Maximum Quality',
    description: 'Best visual quality with moderate compression.',
    imageQuality: 90,
    videoQuality: 85,
    audioBitrate: 192,
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Great quality with significantly smaller files.',
    imageQuality: 78,
    videoQuality: 70,
    audioBitrate: 128,
  },
  {
    id: 'max-compression',
    name: 'Maximum Compression',
    description: 'Smallest practical file size.',
    imageQuality: 60,
    videoQuality: 45,
    audioBitrate: 96,
  },
];

export const DEFAULT_PRESET: PresetId = 'balanced';

export function getPreset(id: PresetId): PresetDef {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[1];
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  format: 'original',
  quality: getPreset(DEFAULT_PRESET).imageQuality,
  preserveResolution: true,
  maxWidth: 1920,
  maxHeight: 1920,
};

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  container: 'mp4',
  codec: 'h264',
  quality: getPreset(DEFAULT_PRESET).videoQuality,
  resolution: 'original',
  fps: 'original',
  audioBitrate: getPreset(DEFAULT_PRESET).audioBitrate,
  engine: 'auto',
};

export const DEFAULT_SETTINGS: CompressionSettings = {
  preset: DEFAULT_PRESET,
  image: DEFAULT_IMAGE_SETTINGS,
  video: DEFAULT_VIDEO_SETTINGS,
};

/** Returns the preset whose values match the given settings, or null for custom values. */
export function matchPreset(image: ImageSettings, video: VideoSettings): PresetId | null {
  const match = PRESETS.find(
    (p) =>
      p.imageQuality === image.quality &&
      p.videoQuality === video.quality &&
      p.audioBitrate === video.audioBitrate,
  );
  return match ? match.id : null;
}
