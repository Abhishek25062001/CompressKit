/**
 * The colors the native screens share with the web app. The values are the tokens in the web
 * project's `src/index.css` (`:root` and `.dark`), so the startup screen, the area behind the
 * status bar and the notices match the tool pages they sit around.
 */
export interface Palette {
  bg: string;
  surface: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  danger: string;
  dangerSoft: string;
}

export const PALETTES: { light: Palette; dark: Palette } = {
  light: {
    bg: '#f6f7f7',
    surface: '#ffffff',
    border: '#e1e5e5',
    fg: '#0d1414',
    muted: '#566162',
    accent: '#0a8069',
    accentFg: '#ffffff',
    danger: '#b8322a',
    dangerSoft: '#fbe9e7',
  },
  dark: {
    bg: '#080a0a',
    surface: '#0f1313',
    border: '#212828',
    fg: '#ebf1f0',
    muted: '#9ba7a6',
    accent: '#34d6ae',
    accentFg: '#03201a',
    danger: '#ff7a6e',
    dangerSoft: '#2d1513',
  },
};

export function paletteFor(dark: boolean): Palette {
  return dark ? PALETTES.dark : PALETTES.light;
}
