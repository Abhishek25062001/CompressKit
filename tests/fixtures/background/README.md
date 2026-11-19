# Background removal fixtures

Synthetic before/after pairs used by `tests/background-matte.test.ts`.

| File | Role |
| --- | --- |
| `*.before.json` | Contaminated RGBA (BG colour bleeding into soft edges) |
| `*.after.json` | Soft float alpha 0–1 — mid-greys must survive (no binary mask) |
| `manifest.json` | Index of cases |

These are tiny (≤64 px) so the suite stays fast. They assert letterbox aspect preservation and that soft mattes are not thresholded away.
