# LaMa inpainting models (watermark remover)

Downloaded by `npm run model:inpaint` into `/models` (gitignored). Served in ≤20 MB parts via Vite `virtual:inpaint-model`, same pattern as background removal.

## Files

| Role | File | Size | SHA-256 |
| --- | --- | --- | --- |
| WebGPU | `lama-512-fp16.onnx` | ~102 MB (106 559 381 B) | `1fa042eaf30a6660b9190f0a1512d27bdceff90fab172af295303cdf2905e516` |
| WASM / CPU | `lama-512-int8.onnx` | ~59 MB (62 074 990 B) | `cab19978adc306622fe37ef60d4a52103b99c98141d499c2a2366a7ed1255dbe` |

Pinned Hugging Face revision: `g-ronimo/lama@386a67cedf9b8bb4fe76798c10c8d77abc0a5cc8`.

Each browser downloads **one** of these on first use; it is then cached by the service worker / HTTP cache for offline runs.

## Inspected ONNX I/O

Both graphs (verified with `onnx-proto`):

- **Input** `input`: `float32` `[1, 4, 512, 512]`
  - Channels 0–2: RGB in **0–1**, pixels to fill set to **0**
  - Channel 3: mask, **1 = fill**, **0 = keep**
- **Output** `output`: `float32` `[1, 3, 512, 512]` — RGB in **0–1**

## License

- **LaMa** — Suvorov et al., “Resolution-robust Large Mask Inpainting with Fourier Convolutions” (WACV 2022), [advimman/lama](https://github.com/advimman/lama) — **Apache-2.0**
- **ONNX export** — [g-ronimo/lama](https://huggingface.co/g-ronimo/lama) — **Apache-2.0** (FFT→matmul fixed-512 graphs for WebGPU / int8 WASM)

## Offline / missing model

If neither file is present at build time, `virtual:inpaint-model` exports `{ gpu: null, cpu: null }` and the tool falls back to the classical exemplar fill in `inpaint.ts`.
