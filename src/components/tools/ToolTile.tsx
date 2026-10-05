import type { Feature } from '../../features/directory';
import { cn } from '../../utils/cn';
import { Link } from '../common/Link';
import { hue } from './hue';

interface ToolTileProps {
  feature: Feature;
  /** The tool already on screen. */
  current?: boolean;
  /** The search result that Enter opens. */
  highlighted?: boolean;
  onPick?: () => void;
  /** Lets the launcher's arrow keys move between tiles. */
  launcherItem?: boolean;
}

/**
 * A tool as a small tile: its icon over its name, three or more to a row. The phone app lists
 * tools this way so all 62 fit in a few screens; the one-line description is still read out by
 * screen readers.
 */
export function ToolTile({ feature, current = false, highlighted = false, onPick, launcherItem = false }: ToolTileProps) {
  return (
    <Link
      to={feature.to}
      onClick={onPick}
      aria-current={current ? 'page' : undefined}
      style={hue(feature.category)}
      {...(launcherItem ? { 'data-launcher-item': '' } : {})}
      className={cn(
        'group flex h-full flex-col items-center gap-2 rounded-2xl border px-1.5 pt-3 pb-2.5 text-center outline-offset-0 transition-[border-color,background-color,transform] duration-150 active:scale-[0.97]',
        current || highlighted ? 'border-(color:--hue)/50 bg-(color:--hue)/8' : 'border-border bg-surface',
      )}
    >
      <span className="hue-tile inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
        <feature.icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="text-[13px] leading-tight font-medium break-words text-fg">{feature.name}</span>
      <span className="sr-only">{feature.description}</span>
    </Link>
  );
}

/** The grid tiles sit in: three to a row on a phone, more on wider screens. */
export const TILE_GRID = 'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6';
