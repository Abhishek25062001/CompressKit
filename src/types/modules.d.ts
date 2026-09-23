declare module 'upng-js' {
  interface UPNGStatic {
    /**
     * Encodes RGBA frames into PNG.
     * @param cnum 0 for lossless, otherwise the number of colors for lossy quantization.
     */
    encode(
      frames: ArrayBuffer[],
      width: number,
      height: number,
      cnum: number,
      delays?: number[],
      forbidPlte?: boolean,
    ): ArrayBuffer;
  }
  const UPNG: UPNGStatic;
  export default UPNG;
}

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } | null) => void,
    ): void;
    free(): void;
  }
  interface Libheif {
    HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
  }
  /** Instantiates synchronously: the WebAssembly binary is embedded in the bundle. */
  export default function createLibheif(options?: Record<string, unknown>): Libheif;
}
