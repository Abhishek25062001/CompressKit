import { create } from 'zustand';
import { detectBrowserSupport, type BrowserSupport } from '../utils/browserSupport';
import {
  detectImageEncodeSupport,
  detectVideoEncodeSupport,
  FFMPEG_CODECS,
  type ImageEncodeSupport,
  type VideoEncodeSupport,
} from '../utils/mediaCapabilities';

interface CapabilitiesState {
  browser: BrowserSupport;
  image: ImageEncodeSupport;
  video: VideoEncodeSupport;
  ready: boolean;
  detect: () => Promise<void>;
}

const NO_WEBCODECS = { h264: false, h265: false, vp9: false, vp8: false, av1: false };

export const useCapabilitiesStore = create<CapabilitiesState>()((set, get) => ({
  browser: detectBrowserSupport(),
  // Optimistic defaults until detection finishes; every encode path re-verifies its output.
  image: { jpeg: true, webp: true, avifNative: false },
  video: { webcodecs: NO_WEBCODECS, ffmpeg: FFMPEG_CODECS, audio: { aac: false, opus: false } },
  ready: false,
  detect: async () => {
    if (get().ready) return;
    const [image, video] = await Promise.all([detectImageEncodeSupport(), detectVideoEncodeSupport()]);
    set({ image, video, ready: true });
  },
}));
