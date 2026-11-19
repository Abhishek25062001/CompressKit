# Background-removal models

Downloaded by `npm run model` into `/models` (gitignored). Served in ≤20 MB parts via Vite `virtual:background-model`. The service worker caches `/models/…` parts for offline reuse after the first download.

## Files

| Role | Model | File | Size |
| --- | --- | --- | --- |
| WebGPU | **BiRefNet lite** (fp16, WebGPU-patched) | `birefnet-lite-fp16-webgpu.onnx` | ~109 MB (114 664 835 B after patch; source 114 538 221 B) |
| WASM / CPU | **IS-Net** general (DIS, fp16) | `isnet-general-fp16.onnx` | ~84 MB (88 152 708 B) |

Pinned downloads (see `scripts/fetch-model.mjs`):

- BiRefNet: `onnx-community/BiRefNet_lite-ONNX@de15b22…` → `onnx/model_fp16.onnx`
- IS-Net: `imgly/isnet-general-onnx@440dea9…` → `onnx/model_fp16.onnx`

Each browser downloads **one** of these on first use (GPU preferred when WebGPU + `shader-f16` are available).

## Inspected ONNX I/O

Verified by decoding the ModelProto with `onnx-proto`:

### BiRefNet (WebGPU)

- **Input** `input_image`: `float32` `[1, 3, 1024, 1024]`
  - RGB, ImageNet mean/std: mean `[123.675, 116.28, 103.53]`, std `[58.395, 57.12, 57.375]` on 0–255 pixels
- **Output** `output_image`: `float32` `[1, 1, 1024, 1024]` — logits; α = sigmoid(logit) × 255

### IS-Net (WASM)

- **Input** `input`: `float32` `[1, 3, 1024, 1024]`
  - RGB normalized as `(x − 128) / 256`
- **Output** `output`: `float32` `[1, 1, 1024, 1024]` — foreground map; stretched so min→0 and max→255 (reference DIS post-process)

Inference always runs at **1024×1024**. The matte is edge-refined (contrast curve + 1 px feather), then **bicubic-upscaled** to the photo’s work resolution and applied as alpha.

## License

| Model | License |
| --- | --- |
| BiRefNet | **MIT** ([ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet); ONNX via onnx-community) |
| IS-Net / DIS | **MIT** export ([imgly/isnet-general-onnx](https://huggingface.co/imgly/isnet-general-onnx)); upstream DIS often cited Apache-2.0 |
| onnxruntime-web | **MIT** |

## Offline / missing model

If neither file is present at **dev** time, `virtual:background-model` exports `{ gpu: null, cpu: null }` and the tool reports that models are missing. A **production build** requires `npm run model` (Vite throws if the files are absent).
