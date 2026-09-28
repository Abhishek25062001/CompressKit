import type { CSSProperties } from 'react';
import type { CategoryId } from '../../features/directory';

/** Sets --hue to a category's colour (index.css), for .hue-tile and text-(--hue) inside. */
export const hue = (id: CategoryId): CSSProperties => ({ '--hue': `var(--cat-${id})` }) as CSSProperties;
