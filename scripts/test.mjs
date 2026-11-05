/**
 * Bundles tests/*.test.ts with Vite, so they resolve imports exactly as the app does, then runs
 * them with Node's built-in test runner. No browser or dev server is started.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const testsDir = join(root, 'tests');
const outDir = join(root, 'node_modules/.cache/ofctools-tests');
const entries = readdirSync(testsDir).filter((f) => f.endsWith('.test.ts'));

rmSync(outDir, { recursive: true, force: true });
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [
    {
      // The paused background remover is reachable through the tool registry but never runs here.
      name: 'test-background-model',
      resolveId: (id) => (id === 'virtual:background-model' ? '\0test-background-model' : undefined),
      load: (id) => (id === '\0test-background-model' ? 'export default { gpu: null, cpu: null };' : undefined),
    },
  ],
  build: {
    ssr: true,
    outDir,
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: Object.fromEntries(entries.map((f) => [f.replace(/\.ts$/, ''), join(testsDir, f)])),
      output: { entryFileNames: '[name].mjs' },
    },
  },
});

const files = entries.map((f) => join(outDir, f.replace(/\.ts$/, '.mjs')));
const { status } = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
