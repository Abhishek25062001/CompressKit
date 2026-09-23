/**
 * Minimal typing for a dedicated worker global scope. The project compiles with the DOM
 * lib, which conflicts with the WebWorker lib, so workers use this narrow interface instead.
 */
export interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export const workerScope = globalThis as unknown as WorkerScope;
