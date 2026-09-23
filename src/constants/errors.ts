import type { ErrorCode, FriendlyError } from '../types/media';

const MESSAGES: Record<ErrorCode, { title: string; message: string }> = {
  UNSUPPORTED_TYPE: {
    title: 'This file type is not supported',
    message: 'CompressKit works with JPG, PNG, WebP and AVIF images and MP4, MOV, WebM and MKV videos.',
  },
  DECODE_FAILED: {
    title: "We couldn't read this file",
    message: 'The file may be damaged, or your browser may not support this format. Try exporting it again as JPG, PNG, MP4 or WebM.',
  },
  ENCODE_UNSUPPORTED: {
    title: "Your browser can't create this format",
    message: 'Pick a different output format in the settings, such as WebP or JPEG.',
  },
  CODEC_UNSUPPORTED: {
    title: "We couldn't process this file",
    message: 'Your browser may not support this video format. Try MP4 or WebM.',
  },
  ENGINE_LOAD_FAILED: {
    title: 'The video engine failed to load',
    message: 'Check your connection and reload the page. The engine is downloaded once and then cached.',
  },
  OUT_OF_MEMORY: {
    title: 'Your browser ran out of memory',
    message: 'This file is too large to process in the browser. Try a lower resolution, close other tabs, or split the video.',
  },
  WORKER_CRASHED: {
    title: 'Processing stopped unexpectedly',
    message: 'The background worker crashed, often because of low memory. Try again, or use a lower resolution.',
  },
  NO_VIDEO_TRACK: {
    title: 'No video found in this file',
    message: 'This file does not seem to contain a video stream.',
  },
  NO_AUDIO_TRACK: {
    title: 'No audio found in this file',
    message: 'This video has no sound track, so there is no audio to extract. Pick a video format instead.',
  },
  FILE_TOO_LARGE: {
    title: 'This file is too large',
    message: 'Browsers cannot reliably process files of this size. Try a smaller file.',
  },
  CANCELLED: {
    title: 'Cancelled',
    message: 'You stopped this file. Press retry to start it again.',
  },
  UNKNOWN: {
    title: "We couldn't process this file",
    message: 'Something went wrong while processing. Try again, or try different settings.',
  },
};

export function toFriendlyError(code: ErrorCode): FriendlyError {
  return { code, ...MESSAGES[code] };
}
