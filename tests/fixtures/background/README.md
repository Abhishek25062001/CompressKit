# Background removal fixtures

Synthetic before/after pairs used by `tests/background-matte.test.ts`.

| File | Role |
| --- | --- |
| `*.before.json` | Contaminated RGBA (BG colour bleeding into soft edges) |
| `*.after.json` | Soft float alpha 0–1 — mid-greys must survive (no binary mask) |
| `manifest.json` | Index of cases |

These are tiny (≤64 px) so the suite stays fast. They assert letterbox aspect preservation and that soft mattes are not thresholded away.

## Real-photo crops (rectangle regression)

| File | Role |
| --- | --- |
| `burgundy-hair.png` | 150×70 crop of the 1536×1024 "Windblown Elegance in Burgundy" portrait at x 200–350, y 930–1000 (hair, bottom left) |
| `burgundy-ear.png` | 80×60 crop of the same photo at x 340–420, y 430–490 (left ear) |

RGB is the original photo; alpha is the matte the remover produced. Before the multi-level foreground fix, the cut-out showed hard-edged near-white rectangles in both spots: the box-window background estimate fell to black where no background pixel was in reach. The tests check that no matte stage forms constant-alpha rectangles, that edge colours never come from a black-background assumption, and that the composite on black never comes out brighter than the photo.
