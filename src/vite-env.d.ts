/// <reference types="vite/client" />

declare module 'virtual:background-model' {
  type ModelFiles = { parts: string[]; size: number; sha256: string };
  /**
   * Self-hosted parts of the background-removal models, each null when it was not downloaded:
   * `gpu` runs on the graphics card (WebGPU), `cpu` on the processor (WebAssembly).
   */
  const models: { gpu: ModelFiles | null; cpu: ModelFiles | null };
  export default models;
}
