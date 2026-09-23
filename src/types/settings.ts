export type PresetId = 'max-quality' | 'balanced' | 'max-compression';

export type ImageOutputFormat = 'original' | 'jpeg' | 'webp' | 'avif' | 'png';

export interface ImageSettings {
  format: ImageOutputFormat;
  /** 1 to 100. Higher means better quality and larger files. */
  quality: number;
  /** When true the original pixel dimensions are kept. */
  preserveResolution: boolean;
  /** Only used when preserveResolution is false. Null means "no limit". */
  maxWidth: number | null;
  maxHeight: number | null;
}

export type VideoContainer = 'mp4' | 'webm';
export type VideoCodecId = 'h264' | 'h265' | 'vp9' | 'vp8' | 'av1';
/** 'original' or the target size of the short side in pixels (1080 means 1080p). */
export type VideoResolution = 'original' | 2160 | 1440 | 1080 | 720 | 480 | 360;
export type VideoFps = 'original' | 60 | 30 | 24;
export type AudioBitrate = 'remove' | 64 | 96 | 128 | 160 | 192;
export type VideoEngineChoice = 'auto' | 'webcodecs' | 'ffmpeg';

export interface VideoSettings {
  container: VideoContainer;
  codec: VideoCodecId;
  /** 1 to 100. Mapped to CRF for FFmpeg and to a bitrate for WebCodecs. */
  quality: number;
  resolution: VideoResolution;
  fps: VideoFps;
  audioBitrate: AudioBitrate;
  engine: VideoEngineChoice;
}

export interface CompressionSettings {
  /** Null when the user tweaked values away from every preset. */
  preset: PresetId | null;
  image: ImageSettings;
  video: VideoSettings;
}
