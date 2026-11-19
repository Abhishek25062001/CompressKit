/** The files the watermark remover serves: `gpu` for WebGPU, `cpu` for WebAssembly. */
export const INPAINT_MODELS: {
  gpu: { name: string; file: string };
  cpu: { name: string; file: string };
};

export function fetchInpaintModels(options?: { optional?: boolean }): Promise<void>;
