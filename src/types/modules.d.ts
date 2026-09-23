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
