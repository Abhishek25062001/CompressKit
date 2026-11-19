# Background-removal models

Downloaded by `npm run model` into `/models` (gitignored). Served in ≤20 MB parts via Vite `virtual:background-model`. The service worker caches `/models/…` parts for offline reuse after the first download.

Hair / fine edges need a **soft float matte**: the pipeline letterboxes (no stretch), runs at 1024×1024, unletterboxes, bicubic-upscales float alpha, guided-filters with the photo as guide, then blur-fusion decontaminates edge colours. See `cutout.ts` / `matte.ts`.

## Files

| Role | Model | File | Size |
| --- | --- | --- | --- |
| WebGPU | **BiRefNet lite** (fp16, WebGPU-patched) | `birefnet-lite-fp16-webgpu.onnx` | ~109 MB (114 664 835 B after patch; source 114 538 221 B) |
| WASM / CPU | **IS-Net** general (DIS, fp16) | `isnet-general-fp16.onnx` | ~84 MB (88 152 708 B) |

Pinned downloads (see `scripts/fetch-model.mjs`):

- BiRefNet: `onnx-community/BiRefNet_lite-ONNX@de15b22…` → `onnx/model_fp16.onnx` (MIT)
- IS-Net: `imgly/isnet-general-onnx@440dea9…` → `onnx/model_fp16.onnx` (MIT export)

Each browser downloads **one** of these on first use (GPU preferred when WebGPU + `shader-f16` are available). Both are hair-capable general-use segmenters; BiRefNet-lite is preferred for detail.

## Inspected ONNX I/O

Verified by decoding the ModelProto with `onnx-proto`:

### BiRefNet (WebGPU)

- **Input** `input_image`: `float32` `[1, 3, 1024, 1024]`
  - RGB, ImageNet mean/std: mean `[123.675, 116.28, 103.53]`, std `[58.395, 57.12, 57.375]` on 0–255 pixels
  - Letterbox pad filled with ImageNet-mean grey `(123,116,104)` so normalised pad ≈ 0
- **Output** `output_image`: `float32` `[1, 1, 1024, 1024]` — logits; α = sigmoid(logit) ∈ [0,1]

### IS-Net (WASM)

- **Input** `input`: `float32` `[1, 3, 1024, 1024]`
  - RGB normalized as `(x − 128) / 256`
- **Output** `output`: `float32` `[1, 1, 1024, 1024]` — foreground map; stretched so min→0 and max→1 (reference DIS post-process)

## License

| Model | License |
| --- | --- |
| BiRefNet | **MIT** ([ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet); ONNX via onnx-community) |
| IS-Net / DIS | **MIT** export ([imgly/isnet-general-onnx](https://huggingface.co/imgly/isnet-general-onnx)); upstream DIS often cited Apache-2.0 |
| onnxruntime-web | **MIT** |

## Offline / missing model

If neither file is present at **dev** time, `virtual:background-model` exports `{ gpu: null, cpu: null }` and the tool reports that models are missing. A **production build** requires `npm run model` (Vite throws if the files are absent).
