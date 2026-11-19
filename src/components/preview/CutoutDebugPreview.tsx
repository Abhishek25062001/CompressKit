import type { CutoutDebugPreviews } from '../../types/background';

const PANELS: { key: keyof CutoutDebugPreviews; title: string; hint: string }[] = [
  { key: 'rawMatteUrl', title: 'Raw matte', hint: 'After bicubic upscale — wide halo shows here' },
  { key: 'refinedMatteUrl', title: 'Refined matte', hint: 'Smoothstep 0.1–0.9 + guided filter' },
  { key: 'onWhiteUrl', title: 'On white', hint: 'Fringing / washout against light BG' },
  { key: 'onBlackUrl', title: 'On black', hint: 'Leftover BG colour or washed-out edges against black' },
  { key: 'onColorUrl', title: 'On green', hint: 'Saturated backdrop — wrong edge colour or blocky patches stand out' },
];

/** Stage panels so you can see which cut-out step causes halo, seams or colour washout. */
export function CutoutDebugPreview({ previews, width, height }: { previews: CutoutDebugPreviews; width?: number; height?: number }) {
  const ratio = width && height ? `${width} / ${height}` : '4 / 3';
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-fg">Debug matte stages</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {PANELS.map(({ key, title, hint }) => (
          <figure key={key} className="overflow-hidden rounded-xl border border-border bg-surface-2/40">
            <div className="checkerboard relative w-full overflow-hidden" style={{ aspectRatio: ratio }}>
              <img src={previews[key]} alt={title} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            </div>
            <figcaption className="space-y-0.5 px-3 py-2">
              <p className="text-xs font-medium text-fg">{title}</p>
              <p className="text-[11px] text-muted">{hint}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
