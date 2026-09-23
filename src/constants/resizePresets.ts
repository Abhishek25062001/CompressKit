import type { ResizePresetId } from '../types/resize';

export interface ResizePreset {
  id: Exclude<ResizePresetId, 'custom' | 'freehand'>;
  name: string;
  /** Where the size comes from, shown under the name. */
  detail: string;
  width: number;
  height: number;
  group: 'Documents' | 'Social media';
}

/** Document sizes are at 300 DPI, the usual print resolution for ID photos. */
export const RESIZE_PRESETS: ResizePreset[] = [
  { id: 'passport', name: 'Passport photo', detail: '35 × 45 mm', width: 413, height: 531, group: 'Documents' },
  { id: 'us-passport', name: 'US passport / visa', detail: '2 × 2 in', width: 600, height: 600, group: 'Documents' },
  { id: 'signature', name: 'Signature', detail: 'Wide strip, 3.5 × 1.5 cm', width: 413, height: 177, group: 'Documents' },
  { id: 'profile', name: 'Profile picture', detail: 'WhatsApp, LinkedIn, square', width: 800, height: 800, group: 'Social media' },
  { id: 'instagram-post', name: 'Instagram post', detail: 'Square', width: 1080, height: 1080, group: 'Social media' },
  { id: 'instagram-portrait', name: 'Instagram portrait', detail: '4:5', width: 1080, height: 1350, group: 'Social media' },
  { id: 'story', name: 'Story / Status', detail: 'Instagram, WhatsApp, 9:16', width: 1080, height: 1920, group: 'Social media' },
  { id: 'youtube-thumbnail', name: 'YouTube thumbnail', detail: '16:9', width: 1280, height: 720, group: 'Social media' },
  { id: 'x-header', name: 'X (Twitter) header', detail: '3:1', width: 1500, height: 500, group: 'Social media' },
  { id: 'linkedin-banner', name: 'LinkedIn banner', detail: '4:1', width: 1584, height: 396, group: 'Social media' },
];

export const MAX_CUSTOM_SIDE = 8000;
