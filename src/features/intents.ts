import { RESIZE_PRESETS } from '../constants/resizePresets';
import { useBackgroundSettingsStore } from '../store/backgroundSettingsStore';
import { useConvertSettingsStore } from '../store/convertSettingsStore';
import { useDocEditorStore } from '../store/docsStore';
import { useResizeSettingsStore } from '../store/resizeSettingsStore';
import { useTrimStore } from '../store/trimStore';
import type { CutoutBackground } from '../types/background';
import type { ConvertSettings } from '../types/convert';
import type { ResizePresetId } from '../types/resize';
import type { TrimSettings } from '../types/trim';
import type { ToolId } from './catalog';
import { openInEditor } from './docs/actions';

type Intents = Record<string, () => void>;

const convert = (patch: Partial<ConvertSettings>) => () => useConvertSettingsStore.getState().update(patch);
const resize = (preset: ResizePresetId) => () => useResizeSettingsStore.getState().update({ preset });
const trim = (patch: Partial<TrimSettings>) => () => useTrimStore.getState().updateSettings(patch);
const background = (value: CutoutBackground) => () => useBackgroundSettingsStore.getState().update({ background: value });

/**
 * Settings a link picks when it opens a tool, named by its hash: "/convert#gif" opens Convert with
 * animated GIF chosen, "/resize#passport" opens Resize with the passport size. The tools launcher
 * and home page link to these (features/directory.ts). PDF tools reads its own hashes.
 */
const INTENTS: Partial<Record<ToolId, Intents>> = {
  convert: {
    jpg: convert({ image: 'jpeg' }),
    png: convert({ image: 'png' }),
    webp: convert({ image: 'webp' }),
    avif: convert({ image: 'avif' }),
    mp4: convert({ video: 'mp4' }),
    webm: convert({ video: 'webm' }),
    gif: convert({ video: 'gif' }),
    mp3: convert({ video: 'mp3' }),
  },
  resize: {
    ...Object.fromEntries(RESIZE_PRESETS.map((p) => [p.id, resize(p.id)])),
    custom: resize('custom'),
    freehand: resize('freehand'),
    // Rotating and mirroring live in the crop editor; a freehand crop keeps the whole photo.
    rotate: resize('freehand'),
  },
  trim: {
    trim: trim({ mode: 'trim', keepAudio: true }),
    split: trim({ mode: 'split', keepAudio: true }),
    mute: trim({ mode: 'trim', keepAudio: false }),
  },
  background: {
    transparent: background('transparent'),
    white: background('white'),
    color: background('color'),
  },
  'edit-docx': {
    // Never replaces a document that is already open.
    new: () => {
      if (!useDocEditorStore.getState().doc) void openInEditor(null);
    },
  },
};

/** Applies the setting a link's hash names, if the tool has one by that name. */
export function applyIntent(id: ToolId, hash: string): void {
  const intents = INTENTS[id];
  // Own names only: "#constructor" or "#__proto__" must not reach Object.prototype.
  if (intents && Object.hasOwn(intents, hash)) intents[hash]();
}
