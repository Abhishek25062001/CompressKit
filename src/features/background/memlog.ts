/**
 * Dev-only memory log for background removal (`npm run dev`). Every export is a no-op in a
 * production build: `import.meta.env.DEV` is false there, so the bundler drops the bodies.
 *
 * What each column measures:
 * - JS heap: `performance.memory.usedJSHeapSize` of that thread (Chrome only). It does not include
 *   ArrayBuffer contents, WebAssembly memory or GPU buffers.
 * - WASM: total size of every WebAssembly.Memory in the worker (ONNX Runtime's heap). It only grows
 *   until the worker is terminated, so its value after a run is also its peak.
 * - GPU: bytes in WebGPU buffers created in the worker and not yet destroyed.
 * - Held: the large typed arrays and canvases this code holds at that moment, by name.
 * The tab's total (Chrome Task Manager) also counts decoded images, canvases and the browser itself.
 */

export const MEMLOG = import.meta.env.DEV;

export type MemStage =
  | 'page load'
  | 'model fetch'
  | 'session create'
  | 'before inference'
  | 'peak during inference'
  | 'after post-processing'
  | 'after cleanup'
  | 'session released (idle 30 s)'
  | 'worker terminated (idle 45 s)'
  | '60 s idle';

const STAGES: MemStage[] = [
  'page load',
  'model fetch',
  'session create',
  'before inference',
  'peak during inference',
  'after post-processing',
  'after cleanup',
  'session released (idle 30 s)',
  'worker terminated (idle 45 s)',
  '60 s idle',
];

export interface MemSample {
  stage: MemStage;
  thread: 'main' | 'worker';
  jsHeap: number | null;
  wasm: number | null;
  gpu: number | null;
  held: Record<string, number>;
  note?: string;
}

export interface MemlogMessage {
  type: 'memlog';
  jobId: string;
  sample: MemSample;
}

const MB = 1024 * 1024;
const mb = (bytes: number | null) => (bytes === null ? '—' : `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`);

function jsHeap(): number | null {
  return (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
}

// --- Worker side -------------------------------------------------------------------------------

const memories = new Set<WebAssembly.Memory>();
let gpuBytes: number | null = null;
let probesInstalled = false;

/**
 * Wraps WebAssembly.Memory / instantiate and GPUDevice.createBuffer so the worker can report how
 * big ONNX Runtime's heap and live GPU buffers are. Call once, before ONNX Runtime loads.
 */
export function installMemoryProbes(): void {
  if (!MEMLOG || probesInstalled) return;
  probesInstalled = true;
  const OriginalMemory = WebAssembly.Memory;
  const PatchedMemory = function (this: unknown, descriptor: WebAssembly.MemoryDescriptor) {
    const memory = new OriginalMemory(descriptor);
    memories.add(memory);
    return memory;
  } as unknown as typeof WebAssembly.Memory;
  PatchedMemory.prototype = OriginalMemory.prototype;
  WebAssembly.Memory = PatchedMemory;

  const collect = (instance: WebAssembly.Instance) => {
    for (const value of Object.values(instance.exports)) if (value instanceof OriginalMemory) memories.add(value);
  };
  const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
  WebAssembly.instantiate = (async (source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) => {
    const result = await originalInstantiate(source as BufferSource, imports);
    collect('instance' in result ? result.instance : (result as WebAssembly.Instance));
    return result;
  }) as typeof WebAssembly.instantiate;
  const originalStreaming = WebAssembly.instantiateStreaming?.bind(WebAssembly);
  if (originalStreaming) {
    WebAssembly.instantiateStreaming = async (source, imports) => {
      const result = await originalStreaming(source, imports);
      collect(result.instance);
      return result;
    };
  }

  const device = (globalThis as { GPUDevice?: { prototype: { createBuffer(d: { size: number }): { destroy(): void } } } }).GPUDevice;
  if (device) {
    gpuBytes = 0;
    const createBuffer = device.prototype.createBuffer;
    device.prototype.createBuffer = function (descriptor: { size: number }) {
      const buffer = createBuffer.call(this, descriptor);
      gpuBytes = (gpuBytes ?? 0) + descriptor.size;
      const destroy = buffer.destroy.bind(buffer);
      let live = true;
      buffer.destroy = () => {
        if (live) gpuBytes = (gpuBytes ?? 0) - descriptor.size;
        live = false;
        destroy();
      };
      return buffer;
    };
  }
}

function wasmBytes(): number | null {
  if (!memories.size) return null;
  let total = 0;
  for (const m of memories) total += m.buffer.byteLength;
  return total;
}

let sink: ((sample: MemSample) => void) | null = null;

/** Where worker samples go (the worker posts them to the page). */
export function setMemlogSink(fn: (sample: MemSample) => void): void {
  sink = fn;
}

export function workerSample(stage: MemStage, held: Record<string, number> = {}, note?: string): MemSample {
  return { stage, thread: 'worker', jsHeap: jsHeap(), wasm: wasmBytes(), gpu: gpuBytes, held, note };
}

/** Records a worker stage. `held` names the big buffers this code holds right now. */
export function memlog(stage: MemStage, held: Record<string, number> = {}, note?: string): void {
  if (!MEMLOG) return;
  sink?.(workerSample(stage, held, note));
}

/**
 * Samples every 25 ms while `work` runs and logs the highest value seen of each column. WASM
 * memory never shrinks, so the value after the run is its peak even when the run blocks the thread.
 */
export async function withPeakSampling<T>(held: Record<string, number>, work: () => Promise<T>): Promise<T> {
  if (!MEMLOG) return work();
  const peak = workerSample('peak during inference', held);
  const take = () => {
    const s = workerSample('peak during inference', held);
    peak.jsHeap = Math.max(peak.jsHeap ?? 0, s.jsHeap ?? 0) || null;
    peak.wasm = Math.max(peak.wasm ?? 0, s.wasm ?? 0) || null;
    peak.gpu = s.gpu === null ? null : Math.max(peak.gpu ?? 0, s.gpu);
  };
  const timer = setInterval(take, 25);
  try {
    return await work();
  } finally {
    clearInterval(timer);
    take();
    sink?.(peak);
  }
}

// --- Page side ---------------------------------------------------------------------------------

interface Run {
  label: string;
  cells: Map<MemStage, MemSample>;
}

const runs: Run[] = [];

function mainSample(stage: MemStage, note?: string): MemSample {
  return { stage, thread: 'main', jsHeap: jsHeap(), wasm: null, gpu: null, held: {}, note };
}

function describe(s: MemSample): string {
  const held = Object.entries(s.held)
    .filter(([, bytes]) => bytes > 0)
    .map(([name, bytes]) => `${name} ${mb(bytes)}`)
    .join(', ');
  const parts = [`${s.thread} JS ${mb(s.jsHeap)}`];
  if (s.thread === 'worker') parts.push(`WASM ${mb(s.wasm)}`, `GPU ${mb(s.gpu)}`);
  if (held) parts.push(`held: ${held}`);
  if (s.note) parts.push(s.note);
  return parts.join(' · ');
}

function current(): Run {
  if (!runs.length) runs.push({ label: 'before any run', cells: new Map() });
  return runs[runs.length - 1];
}

/** Records a sample from either thread in the current run and echoes it to the console. */
export function recordSample(sample: MemSample): void {
  if (!MEMLOG) return;
  const run = current();
  run.cells.set(sample.stage, sample);
  console.debug(`[memlog] ${run.label} · ${sample.stage} · ${describe(sample)}`);
}

export function recordMain(stage: MemStage, note?: string): void {
  if (!MEMLOG) return;
  recordSample(mainSample(stage, note));
}

let pageLoadSample: MemSample | null = null;

/** Starts a new column; the page-load sample is repeated in each so every column reads on its own. */
export function beginRun(fileName: string, bytes: number): void {
  if (!MEMLOG) return;
  pageLoadSample ??= mainSample('page load');
  runs.push({ label: `run ${runs.length + 1} (${fileName}, ${mb(bytes)})`, cells: new Map([['page load', pageLoadSample]]) });
}

/** Markdown table: one row per stage, one column per run. Also `window.ofctoolsMemTable()` in dev. */
export function memTable(): string {
  const header = `| Stage | ${runs.map((r) => r.label).join(' | ')} |`;
  const rule = `| --- | ${runs.map(() => '---').join(' | ')} |`;
  const rows = STAGES.map((stage) => {
    const cells = runs.map((r) => {
      const s = r.cells.get(stage);
      return s ? describe(s) : '—';
    });
    return `| ${stage} | ${cells.join(' | ')} |`;
  });
  return [header, rule, ...rows].join('\n');
}

export function printMemTable(): void {
  if (!MEMLOG) return;
  console.info(`[memlog]\n${memTable()}`);
}

if (MEMLOG && typeof window !== 'undefined') {
  pageLoadSample = mainSample('page load');
  (window as Window & { ofctoolsMemTable?: () => string }).ofctoolsMemTable = () => {
    const table = memTable();
    console.info(table);
    return table;
  };
}
