/// <reference types="vite/client" />

declare module 'virtual:background-model' {
  /** Self-hosted parts of the background-removal model, or null when it was not downloaded. */
  const model: { parts: string[]; size: number; sha256: string } | null;
  export default model;
}
